import { createHash, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { readAuditAfter, type AuditEvent } from './audit.js'
import { authorizeRepoAction, decideInstanceAction, hasRepoPermission } from './authz.js'
import { denialResponse } from './decisionHttp.js'
import { isScopedCredential } from './principal.js'
import { isAuthzEnforce } from './authzInstanceStore.js'
import { userCanSeeNamespace } from './authzVisibility.js'
import { canReviewAccessRequests } from './accessRequests.js'
import { getJob } from './jobsStore.js'
import { getSessionRecord } from './sessionsStore.js'
import { env } from './env.js'
import type { SessionUser } from './session.js'
import { authenticate } from './requireAuth.js'
import { getNovu, noteSubscriber, type NovuMessage } from './novu.js'
import {
  getNotificationCursor as getCursor, getNotificationUser, listNotificationTombstones, listNotificationUsers, notificationUserKey,
  recordNotificationTombstone, saveNotificationPreferences, saveNotificationUser, setNotificationCursor as setCursor,
  type KnownNotificationUser,
} from './notificationsStore.js'
import {
  defaultNotificationPreferences, notificationCategories, notificationQuiet,
  parseNotificationPreferences, resourceIsMuted,
  type NotificationEvent, type NotificationIdentity, type NotificationItem, type NotificationPreferences,
} from './notificationsTypes.js'

export type { NotificationEvent, NotificationItem, NotificationPreferences, NotificationResource } from './notificationsTypes.js'

const DAY = 86_400_000
const RETENTION = 90 * DAY
const CLAIM_FRESHNESS = Math.min(DAY, env.sessionTtlSec * 1000)
const base = '/auth/notifications'
const same = (a: NotificationIdentity | undefined, b: NotificationIdentity) =>
  a?.iss === b.iss && a.sub === b.sub
const identity = (value: unknown): NotificationIdentity | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  return typeof v.iss === 'string' && v.iss && typeof v.sub === 'string' && v.sub
    ? { iss: v.iss, sub: v.sub } : undefined
}
const text = (value: unknown) => typeof value === 'string' && value.length <= 1024 ? value : undefined

/** One message in Novu: what the event said, plus whether it reached the person directly. */
type StoredEvent = Omit<NotificationEvent, 'createdAt'> & { createdAt: string; personal: boolean }
type Entry = { id: string; event: StoredEvent; read: boolean; seen: boolean; receivedAt: string }

/** Novu ids are opaque; hashing keeps the issuer and subject out of its database keys. */
export const subscriberId = (key: string) => `u_${createHash('sha256').update(key).digest('hex').slice(0, 32)}`

/** Offline group claims are a bounded, last-authentication snapshot, not directory synchronization. */
function principal(row: KnownNotificationUser): SessionUser {
  return {
    ...row.identity,
    groups: Date.now() - Date.parse(row.claimsAt) <= CLAIM_FRESHNESS ? row.identity.groups : undefined,
  }
}

export async function rememberNotificationUser(user: SessionUser): Promise<void> {
  if (!user.iss || !user.sub || isScopedCredential(user)) return
  await saveNotificationUser(user)
}

async function authorized(user: SessionUser, event: NotificationEvent, personal: boolean): Promise<boolean> {
  if (event.category === 'security' || event.category === 'access') {
    return personal || (event.audience === 'access-reviewers' && await canReviewAccessRequests(user))
  }
  if (event.category === 'announcements') return true
  if (event.category === 'sessions' || event.resource?.type === 'session') {
    if (!event.owner) return false
    // Match private desktop API's owner/session_admin policy; repo readability is not sufficient.
    return same(event.owner, user) || (await decideInstanceAction(user, 'session.admin')).allow
  }
  const r = event.resource
  if (r?.namespace && r.repo) {
    return event.category === 'jobs' || r.type === 'job'
      ? (await authorizeRepoAction(user, r.namespace, r.repo, 'job.read')).allow
      : !await isAuthzEnforce() || (await hasRepoPermission(user, r.namespace, r.repo, 'read')).ok
  }
  if (r?.namespace) return !await isAuthzEnforce() || await userCanSeeNamespace(user, r.namespace)
  return personal
}

type Viewer = {
  user: SessionUser
  preferences: NotificationPreferences
  tombstones: Map<string, string>
}

async function viewerFor(user: SessionUser): Promise<Viewer> {
  const row = await getNotificationUser(notificationUserKey(user))
  return {
    user,
    preferences: row?.preferences ?? defaultNotificationPreferences(),
    tombstones: await listNotificationTombstones(),
  }
}

async function eligible(v: Viewer, entry: Entry, channel?: 'toast'): Promise<boolean> {
  const event = entry.event
  if (Date.parse(event.createdAt) < Date.now() - RETENTION) return false
  const category = v.preferences.categories[event.category]
  const resource = event.resource
  if (resource?.namespace) {
    const deletions = [v.tombstones.get(JSON.stringify([resource.namespace])),
      v.tombstones.get(JSON.stringify([resource.namespace, resource.repo]))]
    if (deletions.some((deletedAt) => deletedAt && event.createdAt <= deletedAt)) return false
  }
  return v.preferences.enabled && !!category?.enabled && (!channel || category[channel]) &&
    (event.personal || !resourceIsMuted(v.preferences, event.resource)) && await authorized(v.user, event, event.personal)
}

const entryOf = (m: NovuMessage): Entry | undefined => {
  const p = m.payload as Partial<StoredEvent>
  if (!p.id || !p.category || !p.createdAt) return undefined
  return { id: m.id, event: p as StoredEvent, read: m.read, seen: m.seen, receivedAt: m.createdAt }
}

async function inboxEntries(v: Viewer, channel?: 'toast'): Promise<Entry[]> {
  const messages = await getNovu().feed(subscriberId(notificationUserKey(v.user)))
  const out: Entry[] = []
  for (const m of messages) {
    const entry = entryOf(m)
    if (entry && await eligible(v, entry, channel)) out.push(entry)
  }
  return out
}

async function project(input: NotificationEvent, recoveryBarrier?: string): Promise<void> {
  const createdAt = input.createdAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid notification event timestamp')
  if (Date.parse(createdAt) < Date.now() - RETENTION) return
  const cleanIdentity = (value: NotificationIdentity) => ({ iss: value.iss, sub: value.sub })
  const resource = input.resource ? Object.fromEntries(
    Object.entries(input.resource).filter(([key, value]) => ['namespace', 'repo', 'type', 'id'].includes(key) && typeof value === 'string'),
  ) : undefined
  const event = {
    id: input.id, category: input.category, title: input.title, summary: input.summary, createdAt,
    ...(input.href ? { href: input.href } : {}), ...(resource ? { resource } : {}),
    ...(input.actor ? { actor: cleanIdentity(input.actor) } : {}),
    ...(input.owner ? { owner: cleanIdentity(input.owner) } : {}),
    ...(input.audience ? { audience: input.audience } : {}),
  }
  const users = new Map((await listNotificationUsers()).map((row) => [row.key, row]))
  const candidates = new Map<string, boolean>()
  for (const recipient of input.recipients ?? []) candidates.set(notificationUserKey(recipient), true)
  for (const [key, row] of users) {
    if (Date.parse(row.rememberedAt) > Date.parse(createdAt)) continue
    const user = principal(row)
    const personal = candidates.get(key) ?? (['jobs', 'sessions'].includes(event.category) && same(event.owner, user))
    // Recovery cannot reconstruct an old ACL. Conservatively suppress broad fan-out
    // across any later observed access mutation rather than disclose historic activity.
    if (!personal && recoveryBarrier && event.createdAt <= recoveryBarrier) continue
    if (same(event.actor, user) && !personal) continue
    if (event.audience === 'personal' && !personal) continue
    if (await authorized(user, event, personal)) candidates.set(key, personal)
  }
  for (const [key, personal] of candidates) {
    const row = users.get(key)
    // Explicit issuer/subject personal notices may precede the recipient's first browser login.
    if (row && !await authorized(principal(row), event, personal)) continue
    if (!row && !personal) continue
    const id = subscriberId(key)
    noteSubscriber(id)
    await getNovu().trigger(id, event.id, { ...event, personal })
  }
}

export async function emitNotification(event: NotificationEvent): Promise<void> {
  if (!event.id || !notificationCategories.includes(event.category) || !event.title || !event.summary ||
      event.title.length > 160 || event.summary.length > 1000 ||
      (event.href && (!event.href.startsWith('/') || event.href.startsWith('//')))) {
    throw new Error('Invalid notification event')
  }
  await project(event)
}

const summaries: Record<string, [NotificationEvent['category'], string, string]> = {
  'repo.create': ['repositories', 'Repository created', 'A repository was created.'],
  'repo.metadata': ['repositories', 'Repository updated', 'Repository settings changed.'],
  'namespace.create': ['repositories', 'Namespace created', 'A namespace was created.'],
  'branch.create': ['repositories', 'Branch created', 'A repository branch was created.'],
  'branch.update': ['repositories', 'Branch updated', 'A repository branch changed.'],
  'branch.delete': ['repositories', 'Branch deleted', 'A repository branch was deleted.'],
  'merge': ['repositories', 'Merge completed', 'Repository changes were merged.'],
  'workspace.commit': ['repositories', 'Commit published', 'Stage changes were committed.'],
  'workspace.merge': ['repositories', 'Merge completed', 'Workspace changes were merged.'],
  'commit.publish': ['repositories', 'Commit published', 'Repository changes were committed.'],
  'file.write': ['files', 'Files changed', 'Repository files changed.'],
  'file.delete': ['files', 'Files deleted', 'Repository files were deleted.'],
  'workspace.file.write': ['files', 'Workspace files changed', 'Workspace files changed.'],
  'workspace.file.delete': ['files', 'Workspace files deleted', 'Workspace files were deleted.'],
  'job.complete': ['jobs', 'Job completed', 'A job completed successfully.'],
  'job.fail': ['jobs', 'Job failed', 'A job finished with a failure.'],
  'job.cancel': ['jobs', 'Job cancelled', 'A job was cancelled.'],
  'session.ready': ['sessions', 'Desktop ready', 'A desktop session is ready.'],
  'session.fail': ['sessions', 'Desktop failed', 'A desktop session failed.'],
  'session.stop': ['sessions', 'Desktop stopped', 'A desktop session stopped.'],
  'session.destroy': ['sessions', 'Desktop ended', 'A desktop session ended.'],
}

export async function notificationFromAudit(audit: AuditEvent): Promise<NotificationEvent | undefined> {
  const d = audit.detail ?? {}
  const jobId = text(d.job_id)
  const sessionId = text(d.session_id)
  const job = jobId ? await getJob(jobId) : null
  if (audit.status < 200 || audit.status >= 300) {
    if (!(audit.action === 'job.fail' && job?.status === 'failed')) return
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(audit.method.toUpperCase())) return
  let action = audit.action
  if (action === 'job.publish' && job && ['succeeded', 'failed', 'cancelled'].includes(job.status)) {
    action = job.status === 'succeeded' ? 'job.complete' : job.status === 'failed' ? 'job.fail' : 'job.cancel'
  }
  let mapped = summaries[action]
  let audience: NotificationEvent['audience'] = 'resource'
  const targets = [
    identity(d.recipient), identity(d.requester), identity(d.target), identity(d.subject),
    ...(Array.isArray(d.recipients) ? d.recipients.map(identity) : []),
  ].filter((v): v is NotificationIdentity => !!v)
  let owner = identity(d.owner) ?? (job ? identity(job.actor) : undefined) ??
    (sessionId ? identity((await getSessionRecord(sessionId))?.owner) : undefined)
  if (action.startsWith('meta.')) mapped = ['metadata', 'Metadata changed', 'Resource metadata changed.']
  if (/^(?:access-request|access_request)\./.test(action)) {
    mapped = ['access', 'Access request updated', 'An access request was updated.']
    if (action.endsWith('.submit')) {
      audience = 'access-reviewers'
      targets.push(audit.actor)
      mapped = ['access', 'Access requested', 'An access request needs review.']
    } else audience = 'personal'
  }
  if (/^(?:authz\.|membership\.|collaborator\.|instance\.|namespace\.member\.|repo\.collaborator\.)/.test(action)) {
    mapped = ['access', 'Access changed', 'Your access settings changed.']
    audience = 'personal'
  }
  if (/^(?:pat\.|token\.)/.test(action)) {
    mapped = ['security', 'Token settings changed', 'Your personal access token settings changed.']
    audience = 'personal'
    if (!targets.length) targets.push(audit.actor)
  }
  if (!mapped) return
  const targetGroup = d.target && typeof d.target === 'object'
    ? (d.target as Record<string, unknown>).group : undefined
  if (mapped[0] === 'access' && typeof targetGroup === 'string') {
    for (const row of await listNotificationUsers()) {
      if (Date.now() - Date.parse(row.claimsAt) <= CLAIM_FRESHNESS &&
          row.identity.groups?.some((group) => group.toLowerCase() === targetGroup.toLowerCase())) targets.push(row.identity)
    }
  }
  if ((mapped[0] === 'jobs' || mapped[0] === 'sessions') && owner) targets.push(owner)
  if (audience === 'personal' && !targets.length) return
  const [category, title, summary] = mapped
  const namespace = audit.namespace ?? job?.namespace
  const repo = audit.repo ?? job?.repo
  const metadataResource = d.resource && typeof d.resource === 'object' ? d.resource as Record<string, unknown> : {}
  const resourceNamespace = namespace ?? text(metadataResource.namespace)
  const resourceRepo = repo ?? text(metadataResource.repo)
  if (metadataResource.type === 'session' && typeof metadataResource.id === 'string') {
    owner = identity((await getSessionRecord(metadataResource.id))?.owner)
  }
  const type = jobId ? 'job' : sessionId ? 'session' : text(d.path) ? 'path' :
    text(d.branch) ? 'branch' : text(d.workspace_id) ? 'workspace' : text(metadataResource.type)
  const id = jobId ?? sessionId ?? text(d.path) ?? text(d.branch) ?? text(d.workspace_id) ?? text(metadataResource.id)
  const personalOnly = category === 'security' || category === 'access'
  return {
    id: `audit:${audit.id}`, createdAt: audit.ts, category, title, summary, actor: audit.actor,
    audience, recipients: targets, ...(owner ? { owner } : {}),
    ...(!personalOnly && (resourceNamespace || sessionId || metadataResource.type === 'session') ? {
      resource: {
        ...(resourceNamespace ? { namespace: resourceNamespace } : {}),
        ...(resourceRepo ? { repo: resourceRepo } : {}), ...(type ? { type } : {}), ...(id ? { id } : {}),
      },
    } : {}),
    href: category === 'jobs' ? '/jobs' : category === 'sessions' ? '/sessions' :
      personalOnly ? '/profile' : resourceNamespace && resourceRepo
        ? `/n/${encodeURIComponent(resourceNamespace)}/r/${encodeURIComponent(resourceRepo)}` : '/notifications',
  }
}

export async function captureNotificationAudit(event: AuditEvent): Promise<void> {
  await observeDeletion(event)
  const mapped = await notificationFromAudit(event)
  if (mapped) await project(mapped)
}

async function observeDeletion(event: AuditEvent): Promise<void> {
  if (event.status < 200 || event.status >= 300 || !event.namespace) return
  if (event.action === 'repo.delete' && event.repo) await recordNotificationTombstone(JSON.stringify([event.namespace, event.repo]), new Date(event.ts))
  if (event.action === 'namespace.delete') await recordNotificationTombstone(JSON.stringify([event.namespace]), new Date(event.ts))
}

const ACCESS_MUTATION = /^(?:authz\.|instance\.|namespace\.(?:member|settings|delete)|repo\.collaborator|custom-role\.|training\.)/

/** The audit ledger is the recovery source; Novu replays of one event create no second message. */
export async function replayNotificationAudit(): Promise<void> {
  for (let batch = 0; batch < 50; batch++) {
    const cursor = await getCursor()
    const { events, scannedTo } = await readAuditAfter(cursor)
    if (scannedTo === cursor) return
    const recoveryBarrier = events
      .filter((e) => e.status >= 200 && e.status < 300 && ACCESS_MUTATION.test(e.action))
      .reduce<string | undefined>((latest, e) => !latest || e.ts > latest ? e.ts : latest, undefined)
    for (const audit of events) {
      if (!audit.id || !audit.ts || !audit.action || !audit.actor || typeof audit.status !== 'number') continue
      await observeDeletion(audit)
      const mapped = await notificationFromAudit(audit)
      if (mapped) await project(mapped, recoveryBarrier)
    }
    await setCursor(scannedTo)
  }
}

function groupId(row: Entry): string {
  const event = row.event
  if (['access', 'security', 'announcements', 'jobs', 'sessions'].includes(event.category)) return row.id
  const bucket = Math.floor(Date.parse(row.receivedAt) / 300_000)
  return createHash('sha256').update(JSON.stringify([
    event.category, event.resource, event.personal, bucket,
  ])).digest('hex').slice(0, 32)
}

function inboxGroups(entries: Entry[]) {
  const groups = new Map<string, Entry[]>()
  for (const row of entries) {
    const id = groupId(row)
    groups.set(id, [...(groups.get(id) ?? []), row])
  }
  return [...groups].map(([id, rows]) => {
    rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
    const latest = rows[0].event
    const item: NotificationItem = {
      id, category: latest.category, title: latest.title, summary: latest.summary,
      ...(latest.href ? { href: latest.href } : {}), ...(latest.resource ? { resource: latest.resource } : {}),
      createdAt: rows[0].receivedAt, read: rows.every((row) => row.read), count: rows.length,
    }
    return { item, rows }
  }).sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt) || b.item.id.localeCompare(a.item.id))
}

/** Delivery runs through the inbox only; email and push are not offered. */
export function notificationAvailability() {
  return { email: false, push: false }
}

class RequestError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 413) { super(message) }
}

async function requireBrowser(c: Context): Promise<SessionUser> {
  const r = await authenticate(c, { originCheck: true, jsonOnly: true })
  if (!r.ok) throw new RequestError(r.error, r.status)
  return r.user
}

async function jsonBody(c: Context): Promise<unknown> {
  const content = await c.req.text()
  if (Buffer.byteLength(content) > 65_536) throw new RequestError('Request too large', 413)
  try { return JSON.parse(content) } catch { throw new RequestError('Invalid JSON', 400) }
}

export function registerNotificationRoutes(parent: Hono): void {
  const app = new Hono()
  const unavailable = (c: Context, error: unknown) => {
    console.error('[mice-auth] notification request failed', error instanceof Error ? error.name : 'unknown error')
    return c.json({ error: 'Notification storage or delivery unavailable' }, 503)
  }
  app.onError((error, c) => {
    if (error instanceof RequestError) return c.json({ error: error.message }, error.status)
    return unavailable(c, error)
  })
  app.use(`${base}/*`, async (c, next) => {
    try {
      c.header('Cache-Control', 'no-store')
      const user = await requireBrowser(c)
      c.set('notificationUser' as never, user as never)
      await next()
    } catch (error) {
      if (error instanceof RequestError) return c.json({ error: error.message }, error.status)
      return unavailable(c, error)
    }
  })
  // Explicit root middleware because Hono wildcard matching must not be assumed for the bare route.
  const self = async (c: Context) => {
    const cached = c.get('notificationUser' as never) as SessionUser | undefined
    return cached ?? await requireBrowser(c)
  }
  app.get(base, async (c) => {
    const user = await self(c)
    const groups = inboxGroups(await inboxEntries(await viewerFor(user)))
    const unreadCount = groups.filter((g) => !g.item.read).length
    let rows = c.req.query('unread') === '1' ? groups.filter((g) => !g.item.read) : groups
    const cursor = c.req.query('cursor')
    if (cursor) {
      let decoded: { at: string; id: string }
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString())
        if (!decoded.at || !decoded.id) throw new Error('cursor')
      } catch { return c.json({ error: 'Invalid cursor' }, 400) }
      rows = rows.filter((g) => g.item.createdAt < decoded.at || (g.item.createdAt === decoded.at && g.item.id < decoded.id))
    }
    const page = rows.slice(0, 50)
    const last = page.at(-1)?.item
    c.header('Date', new Date().toUTCString())
    c.header('Cache-Control', 'no-store')
    return c.json({
      items: page.map((g) => g.item), unreadCount, cutoff: new Date().toISOString(),
      ...(rows.length > page.length && last ? {
        nextCursor: Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString('base64url'),
      } : {}),
    })
  })
  app.get(`${base}/unread-count`, async (c) => {
    const user = await self(c)
    const groups = inboxGroups(await inboxEntries(await viewerFor(user)))
    return c.json({ unreadCount: groups.filter((g) => !g.item.read).length })
  })
  app.get(`${base}/preferences`, async (c) => {
    const user = await self(c)
    return c.json({ preferences: (await viewerFor(user)).preferences, availability: notificationAvailability() })
  })
  app.patch(`${base}/preferences`, async (c) => {
    const user = await self(c)
    let parsed: NotificationPreferences
    const body = await jsonBody(c)
    try { parsed = parseNotificationPreferences(body) } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid preferences' }, 400)
    }
    await saveNotificationPreferences(user, parsed)
    return c.json({ preferences: parsed, availability: notificationAvailability() })
  })
  app.get(`${base}/resource-overrides`, async (c) => {
    const user = await self(c)
    return c.json({ resourceOverrides: (await viewerFor(user)).preferences.resourceOverrides })
  })
  app.get(`${base}/toast`, async (c) => {
    const user = await self(c)
    const viewer = await viewerFor(user)
    if (notificationQuiet(viewer.preferences)) return c.json({ items: [] })
    const groups = inboxGroups(await inboxEntries(viewer, 'toast')).filter((g) =>
      g.rows.some((row) => !row.seen && Date.parse(row.receivedAt) > Date.now() - DAY),
    ).slice(0, 20)
    await getNovu().mark(
      subscriberId(notificationUserKey(user)),
      groups.flatMap((g) => g.rows.filter((row) => !row.seen).map((row) => row.id)), 'seen',
    )
    return c.json({ items: groups.map((g) => g.item) })
  })
  app.post(`${base}/read-all`, async (c) => {
    const user = await self(c)
    const body = await jsonBody(c) as { before?: unknown }
    if (!body || typeof body.before !== 'string' || !Number.isFinite(Date.parse(body.before))) return c.json({ error: 'Invalid before cutoff' }, 400)
    const before = Math.min(Date.parse(body.before), Date.now())
    const rows = (await inboxEntries(await viewerFor(user))).filter((row) => !row.read && Date.parse(row.receivedAt) <= before)
    await getNovu().mark(subscriberId(notificationUserKey(user)), rows.map((row) => row.id), 'read')
    return c.json({ ok: true })
  })
  app.post(`${base}/announcements`, async (c) => {
    const user = await self(c)
    const denied = denialResponse(c, await decideInstanceAction(user, 'instance.admin'))
    if (denied) return denied
    const body = await jsonBody(c) as { title?: unknown; summary?: unknown }
    if (!body || typeof body.title !== 'string' || typeof body.summary !== 'string' ||
        !body.title.trim() || !body.summary.trim() || body.title.length > 160 || body.summary.length > 1000) {
      return c.json({ error: 'Invalid title or summary' }, 400)
    }
    await emitNotification({
      id: `announcement:${randomUUID()}`, category: 'announcements', title: body.title.trim(),
      summary: body.summary.trim(), audience: 'announcements', href: '/profile',
    })
    return c.json({ ok: true }, 201)
  })
  app.patch(`${base}/:id`, async (c) => {
    const user = await self(c)
    const body = await jsonBody(c) as { read?: unknown }
    if (!body || typeof body.read !== 'boolean') return c.json({ error: 'Expected read boolean' }, 400)
    const group = inboxGroups(await inboxEntries(await viewerFor(user))).find((g) => g.item.id === c.req.param('id'))
    if (!group) return c.json({ error: 'Not found' }, 404)
    await getNovu().mark(subscriberId(notificationUserKey(user)), group.rows.map((row) => row.id), body.read ? 'read' : 'unread')
    return c.json({ ok: true })
  })
  parent.route('/', app)
}

let ticking = false
export async function runNotificationWorkerOnce(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await replayNotificationAudit()
  } finally { ticking = false }
}

export function startNotificationWorker(): () => void {
  let stopped = false
  const tick = () => {
    if (!stopped) void runNotificationWorkerOnce().catch((error) =>
      console.error('[mice-auth] notification worker failed', error instanceof Error ? error.name : 'unknown error'))
  }
  tick()
  const timer = setInterval(tick, 5000)
  timer.unref()
  return () => { stopped = true; clearInterval(timer) }
}

/** Readiness of the notification store: Novu must answer, otherwise the inbox cannot be served. */
export async function notificationReadiness(): Promise<{ ok: boolean; detail?: string }> {
  const health = await getNovu().health()
  return health.ok ? { ok: true } : { ok: false, detail: health.detail }
}
