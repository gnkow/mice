import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Hono, type Context } from 'hono'
import nodemailer from 'nodemailer'
import webpush from 'web-push'
import type { AuditEvent } from './audit.js'
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
import {
  notificationAuditPath, notificationTransaction, notificationUserKey, readNotificationState,
  type NotificationDelivery, type NotificationEntry, type NotificationState, type NotificationSubscription,
} from './notificationsStore.js'
import {
  defaultNotificationPreferences, nextNotificationDelivery, notificationCategories, notificationQuiet,
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
const preferences = (s: NotificationState, key: string) => s.preferences[key] ?? defaultNotificationPreferences()
const identity = (value: unknown): NotificationIdentity | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  return typeof v.iss === 'string' && v.iss && typeof v.sub === 'string' && v.sub
    ? { iss: v.iss, sub: v.sub } : undefined
}
const text = (value: unknown) => typeof value === 'string' && value.length <= 1024 ? value : undefined

function principal(s: NotificationState, key: string): SessionUser | undefined {
  const row = s.users[key]
  if (!row) return undefined
  // Offline group claims are a bounded, last-authentication snapshot, not directory synchronization.
  return {
    ...row.identity,
    groups: Date.now() - Date.parse(row.claimsAt) <= CLAIM_FRESHNESS ? row.identity.groups : undefined,
  }
}

export function rememberNotificationUser(user: SessionUser): void {
  if (!user.iss || !user.sub || isScopedCredential(user)) return
  notificationTransaction((s) => {
    const key = notificationUserKey(user)
    const now = new Date().toISOString()
    s.users[key] = {
      rememberedAt: s.users[key]?.rememberedAt ?? now,
      claimsAt: now,
      identity: {
        iss: user.iss, sub: user.sub, email: user.email, name: user.name,
        ...(user.groups ? { groups: [...user.groups] } : {}),
      },
    }
  })
}

function authorized(user: SessionUser, event: NotificationEvent, personal: boolean): boolean {
  if (event.category === 'security' || event.category === 'access') {
    return personal || (event.audience === 'access-reviewers' && canReviewAccessRequests(user))
  }
  if (event.category === 'announcements') return true
  if (event.category === 'sessions' || event.resource?.type === 'session') {
    if (!event.owner) return false
    // Match private desktop API's owner/session_admin policy; repo readability is not sufficient.
    return same(event.owner, user) || decideInstanceAction(user, 'session.admin').allow
  }
  const r = event.resource
  if (r?.namespace && r.repo) {
    return event.category === 'jobs' || r.type === 'job'
      ? authorizeRepoAction(user, r.namespace, r.repo, 'job.read').allow
      : !isAuthzEnforce() || hasRepoPermission(user, r.namespace, r.repo, 'read').ok
  }
  if (r?.namespace) return !isAuthzEnforce() || userCanSeeNamespace(user, r.namespace)
  return personal
}

function eligible(s: NotificationState, entry: NotificationEntry, channel?: 'toast' | 'email' | 'push'): boolean {
  const event = s.events[entry.event]
  const user = principal(s, entry.user)
  if (!event || !user || Date.parse(event.createdAt) < Date.now() - RETENTION) return false
  const p = preferences(s, entry.user)
  const category = p.categories[event.category]
  const resource = event.resource
  if (resource?.namespace) {
    const deletions = [s.tombstones[JSON.stringify([resource.namespace])],
      s.tombstones[JSON.stringify([resource.namespace, resource.repo])]]
    if (deletions.some((deletedAt) => deletedAt && event.createdAt <= deletedAt)) return false
  }
  return p.enabled && !!category?.enabled && (!channel || category[channel]) &&
    (entry.personal || !resourceIsMuted(p, event.resource)) && authorized(user, event, entry.personal)
}

function prune(s: NotificationState, now = Date.now()): void {
  for (const [id, event] of Object.entries(s.events)) {
    if (Date.parse(event.createdAt) < now - RETENTION) delete s.events[id]
  }
  s.entries = s.entries.filter((row) => !!s.events[row.event])
  const ids = new Set(s.entries.map((row) => row.id))
  s.deliveries = s.deliveries.filter((row) => ids.has(row.entry))
  for (const [key, at] of Object.entries(s.tombstones)) if (Date.parse(at) < now - RETENTION) delete s.tombstones[key]
}

function project(s: NotificationState, input: NotificationEvent, observedAt = new Date().toISOString(), recoveryBarrier?: string): void {
  if (s.events[input.id]) return
  const createdAt = input.createdAt ?? observedAt
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid notification event timestamp')
  if (Date.parse(createdAt) < Date.now() - RETENTION) return
  const cleanIdentity = (value: NotificationIdentity) => ({ iss: value.iss, sub: value.sub })
  const resource = input.resource ? Object.fromEntries(
    Object.entries(input.resource).filter(([key, value]) => ['namespace', 'repo', 'type', 'id'].includes(key) && typeof value === 'string'),
  ) : undefined
  const event = {
    id: input.id, category: input.category, title: input.title, summary: input.summary, createdAt, observedAt,
    ...(input.href ? { href: input.href } : {}), ...(resource ? { resource } : {}),
    ...(input.actor ? { actor: cleanIdentity(input.actor) } : {}),
    ...(input.owner ? { owner: cleanIdentity(input.owner) } : {}),
    ...(input.recipients ? { recipients: input.recipients.map(cleanIdentity) } : {}),
    ...(input.audience ? { audience: input.audience } : {}),
  }
  s.events[event.id] = event
  const candidates = new Map<string, boolean>()
  for (const recipient of event.recipients ?? []) candidates.set(notificationUserKey(recipient), true)
  for (const [key, row] of Object.entries(s.users)) {
    if (Date.parse(row.rememberedAt) > Date.parse(createdAt)) continue
    const user = principal(s, key)!
    const personal = candidates.get(key) ?? (['jobs', 'sessions'].includes(event.category) && same(event.owner, user))
    // Recovery cannot reconstruct an old ACL. Conservatively suppress broad fan-out
    // across any later observed access mutation rather than disclose historic activity.
    if (!personal && recoveryBarrier && event.createdAt <= recoveryBarrier) continue
    if (same(event.actor, user) && !personal) continue
    if (event.audience === 'personal' && !personal) continue
    if (authorized(user, event, personal)) candidates.set(key, personal)
  }
  for (const [key, personal] of candidates) {
    const user = principal(s, key)
    // Explicit issuer/subject personal notices may precede the recipient's first browser login.
    if (user && !authorized(user, event, personal)) continue
    if (!user && !personal) continue
    const entry: NotificationEntry = {
      id: randomUUID(), event: event.id, user: key, personal, read: false,
      toasted: false, receivedAt: observedAt,
    }
    s.entries.push(entry)
    const p = preferences(s, key)
    for (const channel of ['email', 'push'] as const) {
      // Save consent at observation time: enabling a channel never replays historic activity.
      if (!p.enabled || !p.categories[event.category]?.enabled || !p.categories[event.category][channel] ||
          (!personal && resourceIsMuted(p, event.resource))) continue
      s.deliveries.push({
        id: randomUUID(), user: key, entry: entry.id, channel,
        due: nextNotificationDelivery(p, channel), attempts: 0, state: 'pending',
      })
    }
  }
}

export function emitNotification(event: NotificationEvent): void {
  if (!event.id || !notificationCategories.includes(event.category) || !event.title || !event.summary ||
      event.title.length > 160 || event.summary.length > 1000 ||
      (event.href && (!event.href.startsWith('/') || event.href.startsWith('//')))) {
    throw new Error('Invalid notification event')
  }
  notificationTransaction((s) => { prune(s); project(s, event) })
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

export function notificationFromAudit(audit: AuditEvent): NotificationEvent | undefined {
  const d = audit.detail ?? {}
  const jobId = text(d.job_id)
  const sessionId = text(d.session_id)
  const job = jobId ? getJob(jobId) : null
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
    (sessionId ? identity(getSessionRecord(sessionId)?.owner) : undefined)
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
    for (const row of Object.values(readNotificationState().users)) {
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
    owner = identity(getSessionRecord(metadataResource.id)?.owner)
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

export function captureNotificationAudit(event: AuditEvent): void {
  const mapped = notificationFromAudit(event)
  if (mapped || event.action === 'repo.delete' || event.action === 'namespace.delete') {
    notificationTransaction((s) => {
      observeDeletion(s, event)
      prune(s)
      if (mapped) project(s, mapped)
    })
  }
}

function observeDeletion(s: NotificationState, event: AuditEvent): void {
  if (event.status < 200 || event.status >= 300 || !event.namespace) return
  if (event.action === 'repo.delete' && event.repo) s.tombstones[JSON.stringify([event.namespace, event.repo])] = event.ts
  if (event.action === 'namespace.delete') s.tombstones[JSON.stringify([event.namespace])] = event.ts
}

/** The audit journal is a recovery source, not an atomic core-mutation outbox. */
export function replayNotificationAudit(): void {
  let bytes: Buffer
  try { bytes = readFileSync(notificationAuditPath()) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  notificationTransaction((s) => {
    if (s.auditOffset > bytes.length) throw new Error('Notification audit cursor exceeds journal length; journal was truncated')
    let offset = s.auditOffset
    const events: AuditEvent[] = []
    while (offset < bytes.length) {
      const end = bytes.indexOf(10, offset)
      if (end < 0) break // A partial append is retried, never acknowledged.
      const line = bytes.subarray(offset, end).toString('utf8')
      if (line.trim()) {
        const audit = JSON.parse(line) as AuditEvent
        if (!audit.id || !audit.ts || !audit.action || !audit.actor || typeof audit.status !== 'number') {
          throw new Error('Invalid audit event during notification recovery')
        }
        events.push(audit)
      }
      offset = end + 1
    }
    const recoveryBarrier = events.filter((event) => event.status >= 200 && event.status < 300 &&
      /^(?:authz\.|instance\.|namespace\.(?:member|settings|delete)|repo\.collaborator|custom-role\.|training\.)/.test(event.action))
      .reduce<string | undefined>((latest, event) => !latest || event.ts > latest ? event.ts : latest, undefined)
    for (const audit of events) {
      observeDeletion(s, audit)
      const event = notificationFromAudit(audit)
      if (event) project(s, event, new Date().toISOString(), recoveryBarrier)
    }
    s.auditOffset = offset
    prune(s)
  })
}

function groupId(s: NotificationState, row: NotificationEntry): string {
  const event = s.events[row.event]
  if (['access', 'security', 'announcements', 'jobs', 'sessions'].includes(event.category)) return row.id
  const bucket = Math.floor(Date.parse(row.receivedAt) / 300_000)
  return createHash('sha256').update(JSON.stringify([
    row.user, event.category, event.resource, row.personal, bucket,
  ])).digest('hex').slice(0, 32)
}

function inboxGroups(s: NotificationState, key: string, channel?: 'toast' | 'email' | 'push') {
  const groups = new Map<string, NotificationEntry[]>()
  for (const row of s.entries) {
    if (row.user !== key || !eligible(s, row, channel)) continue
    const id = groupId(s, row)
    groups.set(id, [...(groups.get(id) ?? []), row])
  }
  return [...groups].map(([id, rows]) => {
    rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
    const latest = s.events[rows[0].event]
    const item: NotificationItem = {
      id, category: latest.category, title: latest.title, summary: latest.summary,
      ...(latest.href ? { href: latest.href } : {}), ...(latest.resource ? { resource: latest.resource } : {}),
      createdAt: rows[0].receivedAt, read: rows.every((row) => row.read), count: rows.length,
    }
    return { item, rows }
  }).sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt) || b.item.id.localeCompare(a.item.id))
}

function emailConfig() {
  return { url: process.env.NOTIFICATIONS_SMTP_URL, from: process.env.NOTIFICATIONS_EMAIL_FROM }
}
function pushConfig() {
  return {
    publicKey: process.env.NOTIFICATIONS_VAPID_PUBLIC_KEY,
    privateKey: process.env.NOTIFICATIONS_VAPID_PRIVATE_KEY,
    subject: process.env.NOTIFICATIONS_VAPID_SUBJECT,
  }
}
export function notificationAvailability() {
  const mail = emailConfig()
  const push = pushConfig()
  return {
    email: !!mail.url && !!mail.from,
    push: !!push.publicKey && !!push.privateKey && !!push.subject,
    ...(push.publicKey && push.privateKey && push.subject ? { vapidPublicKey: push.publicKey } : {}),
  }
}

export function parseNotificationSubscription(value: unknown): NotificationSubscription {
  if (!value || typeof value !== 'object') throw new Error('Invalid push subscription')
  const s = value as NotificationSubscription
  if (typeof s.endpoint !== 'string' || s.endpoint.length > 4096) throw new Error('Invalid push endpoint')
  let url: URL
  try { url = new URL(s.endpoint) } catch { throw new Error('Invalid push endpoint') }
  // No user-controlled fetch targets, custom ports, suffix tricks or credentials.
  const host = url.hostname.toLowerCase()
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
    host === 'web.push.apple.com' || host.endsWith('.notify.windows.com') || host === 'notify.windows.com'
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) {
    throw new Error('Unsupported push service endpoint')
  }
  if (!s.keys || typeof s.keys.auth !== 'string' || typeof s.keys.p256dh !== 'string' ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(s.keys.auth) || !/^[A-Za-z0-9_-]+={0,2}$/.test(s.keys.p256dh) ||
      Buffer.from(s.keys.auth, 'base64url').length !== 16 ||
      Buffer.from(s.keys.p256dh, 'base64url').length !== 65) throw new Error('Invalid push subscription keys')
  if (s.expirationTime !== undefined && s.expirationTime !== null &&
      (typeof s.expirationTime !== 'number' || !Number.isFinite(s.expirationTime))) throw new Error('Invalid subscription expiration')
  return {
    endpoint: url.href, keys: { auth: s.keys.auth, p256dh: s.keys.p256dh },
    ...(s.expirationTime !== undefined ? { expirationTime: s.expirationTime } : {}),
  }
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
  app.onError((error, c) => {
    if (error instanceof RequestError) return c.json({ error: error.message }, error.status)
    console.error('[mice-auth] notification request failed', error.name)
    return c.json({ error: 'Notification storage or delivery unavailable' }, 503)
  })
  app.use(`${base}/*`, async (c, next) => {
    try {
      c.header('Cache-Control', 'no-store')
      const user = await requireBrowser(c)
      c.set('notificationUser' as never, user as never)
      await next()
    } catch (error) {
      if (error instanceof RequestError) return c.json({ error: error.message }, error.status)
      console.error('[mice-auth] notification request failed', error instanceof Error ? error.name : 'unknown error')
      return c.json({ error: 'Notification storage or delivery unavailable' }, 503)
    }
  })
  // Explicit root middleware because Hono wildcard matching must not be assumed for the bare route.
  const self = async (c: Context) => {
    const cached = c.get('notificationUser' as never) as SessionUser | undefined
    return cached ?? requireBrowser(c)
  }
  app.get(base, async (c) => {
    const user = await self(c)
    const s = readNotificationState()
    const groups = inboxGroups(s, notificationUserKey(user))
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
    const groups = inboxGroups(readNotificationState(), notificationUserKey(user))
    return c.json({ unreadCount: groups.filter((g) => !g.item.read).length })
  })
  app.get(`${base}/preferences`, async (c) => {
    const user = await self(c)
    return c.json({ preferences: preferences(readNotificationState(), notificationUserKey(user)), availability: notificationAvailability() })
  })
  app.patch(`${base}/preferences`, async (c) => {
    const user = await self(c)
    let parsed: NotificationPreferences
    const body = await jsonBody(c)
    try { parsed = parseNotificationPreferences(body) } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid preferences' }, 400)
    }
    notificationTransaction((s) => {
      const key = notificationUserKey(user)
      s.preferences[key] = parsed
      for (const delivery of s.deliveries) {
        if (delivery.user !== key || delivery.state !== 'pending') continue
        const row = s.entries.find((entry) => entry.id === delivery.entry)
        if (!row || !eligible(s, row, delivery.channel)) delivery.state = 'cancelled'
        else delivery.due = nextNotificationDelivery(parsed, delivery.channel)
      }
    })
    return c.json({ preferences: parsed, availability: notificationAvailability() })
  })
  app.get(`${base}/resource-overrides`, async (c) => {
    const user = await self(c)
    return c.json({ resourceOverrides: preferences(readNotificationState(), notificationUserKey(user)).resourceOverrides })
  })
  app.get(`${base}/toast`, async (c) => {
    const user = await self(c)
    const items = notificationTransaction((s) => {
      const key = notificationUserKey(user)
      if (notificationQuiet(preferences(s, key))) return []
      const groups = inboxGroups(s, key, 'toast').filter((g) =>
        g.rows.some((row) => !row.toasted && Date.parse(row.receivedAt) > Date.now() - DAY),
      ).slice(0, 20)
      for (const group of groups) for (const row of group.rows) row.toasted = true
      return groups.map((g) => g.item)
    })
    return c.json({ items })
  })
  app.post(`${base}/read-all`, async (c) => {
    const user = await self(c)
    const body = await jsonBody(c) as { before?: unknown }
    if (!body || typeof body.before !== 'string' || !Number.isFinite(Date.parse(body.before))) return c.json({ error: 'Invalid before cutoff' }, 400)
    const before = Math.min(Date.parse(body.before), Date.now())
    notificationTransaction((s) => {
      for (const row of s.entries) if (row.user === notificationUserKey(user) && Date.parse(row.receivedAt) <= before && eligible(s, row)) row.read = true
    })
    return c.json({ ok: true })
  })
  app.post(`${base}/push-subscriptions`, async (c) => {
    const user = await self(c)
    const body = await jsonBody(c)
    let subscription: NotificationSubscription
    try { subscription = parseNotificationSubscription(body) } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Invalid subscription' }, 400)
    }
    notificationTransaction((s) => {
      // A browser endpoint belongs to one account; never send another account's payload to it.
      for (const key of Object.keys(s.subscriptions)) s.subscriptions[key] = s.subscriptions[key].filter((row) => row.endpoint !== subscription.endpoint)
      const key = notificationUserKey(user)
      const rows = s.subscriptions[key] ?? []
      if (rows.length >= 20) throw new RequestError('Too many push subscriptions', 400)
      s.subscriptions[key] = [...rows, subscription]
    })
    return c.json({ ok: true }, 201)
  })
  app.delete(`${base}/push-subscriptions`, async (c) => {
    const user = await self(c)
    const body = await jsonBody(c) as { endpoint?: unknown }
    if (!body || typeof body.endpoint !== 'string') return c.json({ error: 'Invalid endpoint' }, 400)
    notificationTransaction((s) => {
      const key = notificationUserKey(user)
      s.subscriptions[key] = (s.subscriptions[key] ?? []).filter((row) => row.endpoint !== body.endpoint)
    })
    return c.json({ ok: true })
  })
  app.post(`${base}/announcements`, async (c) => {
    const user = await self(c)
    const denied = denialResponse(c, decideInstanceAction(user, 'instance.admin'))
    if (denied) return denied
    const body = await jsonBody(c) as { title?: unknown; summary?: unknown }
    if (!body || typeof body.title !== 'string' || typeof body.summary !== 'string' ||
        !body.title.trim() || !body.summary.trim() || body.title.length > 160 || body.summary.length > 1000) {
      return c.json({ error: 'Invalid title or summary' }, 400)
    }
    emitNotification({
      id: `announcement:${randomUUID()}`, category: 'announcements', title: body.title.trim(),
      summary: body.summary.trim(), audience: 'announcements', href: '/profile',
    })
    return c.json({ ok: true }, 201)
  })
  app.patch(`${base}/:id`, async (c) => {
    const user = await self(c)
    const body = await jsonBody(c) as { read?: unknown }
    if (!body || typeof body.read !== 'boolean') return c.json({ error: 'Expected read boolean' }, 400)
    const found = notificationTransaction((s) => {
      const group = inboxGroups(s, notificationUserKey(user)).find((g) => g.item.id === c.req.param('id'))
      if (!group) return false
      for (const row of group.rows) row.read = body.read as boolean
      return true
    })
    return found ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404)
  })
  parent.route('/', app)
}

function claimDelivery(): NotificationDelivery[] {
  return notificationTransaction((s) => {
    prune(s)
    const now = Date.now()
    for (const d of s.deliveries) {
      if (d.state === 'sending' && (d.leaseUntil ?? 0) <= now) {
        d.state = 'pending'
        delete d.lease
        delete d.leaseUntil
      }
    }
    const ready = s.deliveries.filter((d) => d.state === 'pending' && d.due <= now)
    const first = ready[0]
    if (!first) return []
    const p = preferences(s, first.user)
    const rows = first.channel === 'email' && p.emailSchedule !== 'immediate'
      ? ready.filter((d) => d.user === first.user && d.channel === 'email').slice(0, 200)
      : [first]
    const claim = randomUUID()
    const claimed: NotificationDelivery[] = []
    for (const d of rows) {
      const row = s.entries.find((e) => e.id === d.entry)
      if (!row || !eligible(s, row, d.channel)) { d.state = 'cancelled'; continue }
      if (notificationQuiet(p)) { d.due = nextNotificationDelivery(p, 'push'); continue }
      d.state = 'sending'
      d.lease = claim
      d.leaseUntil = now + 120_000
      d.attempts++
      claimed.push({ ...d })
    }
    return claimed
  })
}

/** Provider errors are classified, not persisted verbatim (they may contain contacts or endpoint secrets). */
function failureCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { statusCode?: number; code?: string }
    if (typeof e.statusCode === 'number') return `provider_http_${e.statusCode}`
    if (typeof e.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(e.code)) return e.code
  }
  return 'delivery_failed'
}

async function deliver(batch: NotificationDelivery[]): Promise<void> {
  const first = batch[0]
  let failure: unknown
  let cancelled = false
  try {
    // Reload after claiming, so preference/access updates cannot reuse an old projection.
    const s = readNotificationState()
    const rows = batch.map((d) => s.entries.find((row) => row.id === d.entry)).filter((row): row is NotificationEntry =>
      !!row && eligible(s, row, first.channel))
    const user = principal(s, first.user)
    if (!rows.length || !user) cancelled = true
    else {
      const events = rows.map((row) => s.events[row.event])
      if (first.channel === 'email') {
        const config = emailConfig()
        if (!config.url || !config.from) throw new Error('Email transport not configured')
        if (!/^[^\s@<>,;\r\n]+@[^\s@<>,;\r\n]+\.[^\s@<>,;\r\n]+$/.test(user.email)) throw new Error('Recipient contact unavailable')
        const transport = nodemailer.createTransport(config.url, {
          disableFileAccess: true, disableUrlAccess: true,
        })
        const result = await transport.sendMail({
          from: config.from, to: { name: user.name, address: user.email },
          subject: events.length > 1 ? `MICE: ${events.length} notifications` : `MICE: ${events[0].title}`,
          text: events.map((e) => `${e.title}\n${e.summary}`).join('\n\n') +
            '\n\nManage notification preferences in MICE: Profile > Notifications.',
          messageId: `<${createHash('sha256').update(batch.map((d) => d.id).sort().join(',')).digest('hex')}@mice-notifications>`,
        })
        if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP did not accept recipient')
      } else {
        const config = pushConfig()
        if (!config.publicKey || !config.privateKey || !config.subject) throw new Error('Web Push not configured')
        const subscriptions = s.subscriptions[first.user] ?? []
        if (!subscriptions.length) throw new Error('No active push subscription')
        let accepted = 0
        let failed: unknown
        for (const subscription of subscriptions) {
          try {
            parseNotificationSubscription(subscription)
            await webpush.sendNotification(subscription, JSON.stringify({
              title: events[0].title, body: events[0].summary,
              href: events[0].href ?? '/notifications', id: `mice-${first.entry}`,
            }), {
              vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
              TTL: 3600, timeout: 15_000,
            })
            accepted++
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode
            if (status === 404 || status === 410) {
              notificationTransaction((live) => {
                live.subscriptions[first.user] = (live.subscriptions[first.user] ?? []).filter((row) => row.endpoint !== subscription.endpoint)
              })
            } else failed = error
          }
        }
        if (failed) throw failed
        if (!accepted) throw new Error('No push provider accepted delivery')
      }
    }
  } catch (error) {
    failure = error
    console.error('[mice-auth] notification delivery failed', { channel: first.channel, code: failureCode(error), attempts: first.attempts })
  }
  notificationTransaction((s) => {
    for (const claimed of batch) {
      const d = s.deliveries.find((row) => row.id === claimed.id)
      if (!d || d.state !== 'sending' || d.lease !== claimed.lease) continue
      delete d.lease
      delete d.leaseUntil
      if (cancelled) d.state = 'cancelled'
      else if (!failure) { d.state = 'sent'; delete d.lastError }
      else {
        d.lastError = failureCode(failure)
        d.state = d.attempts >= 12 ? 'dead' : 'pending'
        d.due = Date.now() + Math.min(6 * 3_600_000, 15_000 * 2 ** (d.attempts - 1))
      }
    }
  })
}

let ticking = false
export async function runNotificationWorkerOnce(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    replayNotificationAudit()
    for (let count = 0; count < 50; count++) {
      const batch = claimDelivery()
      if (!batch.length) break
      await deliver(batch)
    }
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
