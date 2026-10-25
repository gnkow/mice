import './db/testSchema.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, beforeEach, describe, it } from 'node:test'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import type { SessionUser } from './session.js'
import type { AuditEvent } from './audit.js'

process.env.SESSION_SECRET = 'notification-test-session-secret'
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@notifications.test'
process.env.AUTHZ_GROUP_BOOTSTRAP = '{}'
process.env.PUBLIC_WEB_ORIGIN = 'http://localhost'

const {
  captureNotificationAudit, emitNotification, notificationFromAudit, registerNotificationRoutes,
  rememberNotificationUser, replayNotificationAudit, subscriberId,
} = await import('./notifications.js')
const { getNotificationCursor, listNotificationUsers, notificationUserKey } = await import('./notificationsStore.js')
const { defaultNotificationPreferences, notificationQuiet, parseNotificationPreferences, resourceIsMuted } = await import('./notificationsTypes.js')
const { getNovu, purgeTouchedSubscribers, useNovu } = await import('./novu.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { getDb } = await import('./db/database.js')
const { notificationCursor, notificationTombstones, notificationUsers } = await import('./db/schema.js')
const { sealSession } = await import('./session.js')
const { setRepoCollaborator, removeRepoCollaborator, setRepoGroupCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { preparePrincipal } = await import('./authz.js')

// A private issuer keeps this file's Novu subscribers apart from every other test file's.
const iss = `https://idp.test/${randomUUID()}`
const admin: SessionUser = { iss, sub: 'admin', email: 'admin@notifications.test', emailVerified: true, name: 'Admin' }
const reader: SessionUser = { iss, sub: 'reader', email: 'reader@notifications.test', name: 'Reader' }
const outsider: SessionUser = { iss, sub: 'outsider', email: 'other@notifications.test', name: 'Other' }
const app = new Hono()
registerNotificationRoutes(app)
const ledger = await openLedger(immudbConfig())
const realNovu = getNovu()

async function request(path = '', method = 'GET', body?: unknown, user: SessionUser | null = reader, origin = 'http://localhost') {
  const headers: Record<string, string> = { origin }
  if (user) headers.cookie = `mice_session=${await sealSession(user)}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return app.request(`http://localhost/auth/notifications${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

type Inbox = { items: Array<{ id: string; count: number; read: boolean; createdAt: string; resource?: unknown }>; unreadCount: number; nextCursor?: string }
/** Novu creates messages asynchronously after the trigger; wait until `count` exist for the user. */
async function settled(user: SessionUser, count: number): Promise<void> {
  const deadline = Date.now() + 20_000
  for (;;) {
    const have = (await realNovu.feed(subscriberId(notificationUserKey(user)))).length
    if (have >= count) return
    if (Date.now() > deadline) throw new Error(`expected ${count} messages for ${user.sub}, have ${have}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
async function inbox(user = reader): Promise<Inbox> {
  const response = await request('', 'GET', undefined, user)
  assert.equal(response.status, 200)
  return await response.json() as Inbox
}
async function event(overrides: Partial<Parameters<typeof emitNotification>[0]> = {}) {
  await emitNotification({
    id: randomUUID(), category: 'files', title: 'Files changed', summary: 'Repository files changed.',
    resource: { namespace: 'team', repo: 'data', type: 'path', id: 'docs/a.txt' },
    actor: admin, audience: 'resource', ...overrides,
  })
}
function audit(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: randomUUID(), ts: new Date().toISOString(), actor: admin, via: 'session', method: 'POST',
    path: '/api/repos/team/data/file/main/a', status: 200, action: 'file.write',
    namespace: 'team', repo: 'data', ...overrides,
  }
}
const journal = (e: AuditEvent) => ledger.append(e.id, JSON.stringify(e))

beforeEach(async () => {
  await purgeTouchedSubscribers()
  useNovu(realNovu)
  for (const t of [notificationUsers, notificationTombstones, notificationCursor]) await getDb().delete(t)
  await preparePrincipal(admin)
  await createNamespaceAuthz(admin, 'team', 'none')
  await setRepoCollaborator('team', 'data', reader, 'read')
  await removeRepoCollaborator('team', 'data', outsider)
  await rememberNotificationUser({ ...admin, idToken: 'NEVER_PERSIST_ID_TOKEN', patScopes: undefined })
  await rememberNotificationUser(reader)
  await rememberNotificationUser(outsider)
})
after(async () => {
  await purgeTouchedSubscribers()
  await ledger.close()
})

await describe('notification authorization, inbox and API', async () => {
  await it('is session-only, self-scoped, CSRF protected and rejects malformed requests', async () => {
    assert.equal((await request('', 'GET', undefined, null)).status, 401)
    assert.equal((await request('/preferences', 'PATCH', defaultNotificationPreferences(), reader, 'https://evil.test')).status, 403)
    assert.equal((await request('/preferences', 'PATCH', { enabled: true })).status, 400)
    assert.equal((await request('/read-all', 'POST', {})).status, 400)
    assert.equal((await request('/announcements', 'POST', { title: 'Hi', summary: 'Hello' })).status, 403)
    const invalid = await app.request('http://localhost/auth/notifications/read-all', {
      method: 'POST', headers: { cookie: `mice_session=${await sealSession(reader)}`, origin: 'http://localhost', 'content-type': 'application/json' },
      body: '{',
    })
    assert.equal(invalid.status, 400)
  })

  await it('persists safe offline identities and suppresses actor echoes and unauthorized readers', async () => {
    await event()
    await settled(reader, 1)
    assert.equal((await inbox(reader)).items.length, 1)
    assert.equal((await inbox(admin)).items.length, 0)
    assert.equal((await inbox(outsider)).items.length, 0)
    const serialized = JSON.stringify(await listNotificationUsers())
    assert(!serialized.includes('NEVER_PERSIST_ID_TOKEN'))
    assert(!serialized.includes('patScopes'))
    await removeRepoCollaborator('team', 'data', reader)
    assert.equal((await inbox(reader)).unreadCount, 0)
    assert.equal((await request('/unread-count')).status, 200)
  })

  await it('does not backfill resource events to newly registered users but stores explicit personal targets', async () => {
    const newcomer = { ...reader, sub: 'newcomer' }
    await setRepoCollaborator('team', 'data', newcomer, 'read')
    await event()
    await emitNotification({
      id: 'personal-new', category: 'access', title: 'Access changed', summary: 'Your access changed.',
      recipients: [newcomer], audience: 'personal',
    })
    await rememberNotificationUser(newcomer)
    await settled(newcomer, 1)
    const result = await inbox(newcomer)
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].resource, undefined)
    await event()
    await settled(newcomer, 2)
    assert.equal((await inbox(newcomer)).items.length, 2)
  })

  await it('groups constituents, reopens read groups, and applies read-all only through a cutoff', async () => {
    await event()
    await event()
    await settled(reader, 2)
    let result = await inbox()
    assert.equal(result.items[0].count, 2)
    assert.equal(result.unreadCount, 1)
    const id = result.items[0].id
    assert.equal((await request(`/${id}`, 'PATCH', { read: true })).status, 200)
    assert.equal((await inbox()).unreadCount, 0)
    await event()
    await settled(reader, 3)
    result = await inbox()
    assert.equal(result.items[0].id, id)
    assert.equal(result.items[0].count, 3)
    assert.equal(result.unreadCount, 1)
    const cutoff = new Date().toISOString()
    await new Promise((r) => setTimeout(r, 50))
    await event({ category: 'security', recipients: [reader], audience: 'personal', resource: undefined })
    await settled(reader, 4)
    assert.equal((await request('/read-all', 'POST', { before: cutoff })).status, 200)
    assert.equal((await inbox()).unreadCount, 1)
    assert.equal((await request(`/${id}`, 'PATCH', { read: false }, outsider)).status, 404)
  })

  await it('supports unread filtering and stable opaque pagination', async () => {
    const ids = Array.from({ length: 55 }, () => randomUUID())
    for (let i = 0; i < ids.length; i += 11) {
      await Promise.all(ids.slice(i, i + 11).map((id) => event({ id, category: 'security', recipients: [reader], audience: 'personal', resource: undefined })))
    }
    await settled(reader, 55)
    const first = await inbox()
    assert.equal(first.items.length, 50)
    assert(first.nextCursor)
    const second = await request(`?cursor=${first.nextCursor}&unread=1`)
    assert.equal((await second.json()).items.length, 5)
    assert.equal((await request('?cursor=garbage')).status, 400)
  })

  await it('keeps private sessions and session metadata private; includes personal asynchronous outcomes', async () => {
    await event({
      category: 'sessions', owner: reader, actor: reader, recipients: [reader],
      resource: { type: 'session', id: 'private' },
    })
    await settled(reader, 1)
    assert.equal((await inbox(reader)).items.length, 1)
    assert.equal((await inbox(outsider)).items.length, 0)
    await setRepoCollaborator('team', 'data', outsider, 'read')
    await event({
      category: 'metadata', owner: reader,
      resource: { namespace: 'team', repo: 'data', type: 'session', id: 'private' },
    })
    await settled(reader, 2)
    assert.equal((await inbox(outsider)).items.length, 0)
    assert.equal((await inbox(reader)).items.length, 2)
  })

  await it('observes hierarchy, personal relevance, preferences and quiet-hour toast claiming', async () => {
    const p = defaultNotificationPreferences()
    p.resourceOverrides = [
      { resource: { namespace: 'team' }, mode: 'mute' },
      { resource: { namespace: 'team', repo: 'data', type: 'path', id: 'docs' }, mode: 'watch' },
    ]
    assert.equal((await request('/preferences', 'PATCH', p)).status, 200)
    await event()
    await event({ resource: { namespace: 'team', repo: 'data', type: 'path', id: 'hidden/a' } })
    await settled(reader, 2)
    assert.equal((await inbox()).items.length, 1)
    assert.equal((await (await request('/toast')).json()).items.length, 1)
    assert.equal((await (await request('/toast')).json()).items.length, 0)
    const now = new Date()
    p.quietHours = {
      enabled: true, start: now.toISOString().slice(11, 16),
      end: new Date(now.getTime() + 3_600_000).toISOString().slice(11, 16),
    }
    assert.equal((await request('/preferences', 'PATCH', p)).status, 200)
    await event()
    await settled(reader, 3)
    assert.equal((await (await request('/toast')).json()).items.length, 0)
    assert.equal((await inbox()).items[0].count, 2)
    p.enabled = false
    await request('/preferences', 'PATCH', p)
    assert.equal((await inbox()).unreadCount, 0)
  })

  await it('expires offline group snapshots and never stores PAT-scoped principals', async () => {
    const grouped = { ...outsider, groups: ['readers'] }
    await setRepoGroupCollaborator('team', 'group-repo', 'readers', 'read')
    await rememberNotificationUser(grouped)
    await event({ resource: { namespace: 'team', repo: 'group-repo' } })
    await settled(grouped, 1)
    assert.equal((await inbox(grouped)).items.length, 1)
    const stale = new Date(Date.now() - 2 * 86_400_000)
    await getDb().update(notificationUsers).set({ claimsAt: stale }).where(eq(notificationUsers.userKey, notificationUserKey(grouped)))
    await event({ resource: { namespace: 'team', repo: 'group-repo' } })
    await new Promise((r) => setTimeout(r, 500))
    assert.equal((await realNovu.feed(subscriberId(notificationUserKey(grouped)))).length, 1)
    await rememberNotificationUser({ ...grouped, sub: 'pat-only', patScopes: [{ namespace: 'team', maxRole: 'read' }] })
    assert.equal((await listNotificationUsers()).some((u) => u.identity.sub === 'pat-only'), false)
  })

  await it('announcements reach registered users and preserve channel defaults/availability', async () => {
    const response = await request('/announcements', 'POST', { title: 'Maintenance', summary: 'Scheduled downtime.' }, admin)
    assert.equal(response.status, 201)
    await settled(reader, 1)
    await settled(outsider, 1)
    assert.equal((await inbox(reader)).items.length, 1)
    assert.equal((await inbox(outsider)).items.length, 1)
    const settings = await (await request('/preferences')).json()
    assert.deepEqual(settings.availability, { email: false, push: false })
    assert.equal(settings.preferences.categories.files.toast, true)
    assert.equal(settings.preferences.categories.files.email, false)
  })

  await it('answers 503 when Novu is unreachable, and recovers without losing the stored preferences', async () => {
    assert.equal((await request('/preferences', 'PATCH', defaultNotificationPreferences())).status, 200)
    useNovu({ ...realNovu, feed: async () => { throw new Error('Novu unreachable') } })
    assert.equal((await request()).status, 503)
    assert.equal((await request('/unread-count')).status, 503)
    useNovu(realNovu)
    assert.equal((await request()).status, 200)
  })
})

await describe('notification preferences and recovery', async () => {
  await it('validates timezones and nearest resource overrides', () => {
    const p = defaultNotificationPreferences()
    p.timezone = 'America/New_York'
    p.quietHours = { enabled: true, start: '22:00', end: '08:00' }
    assert(notificationQuiet(p, new Date('2026-03-08T06:59:00Z')))
    assert.throws(() => parseNotificationPreferences({ ...p, timezone: 'Not/AZone' }))
    p.resourceOverrides = [
      { resource: { namespace: 'team' }, mode: 'mute' },
      { resource: { namespace: 'team', repo: 'data', type: 'directory', id: 'docs' }, mode: 'watch' },
      { resource: { namespace: 'team', repo: 'data', type: 'path', id: 'docs/private' }, mode: 'mute' },
    ]
    assert.equal(resourceIsMuted(p, { namespace: 'team', repo: 'data', type: 'file', id: 'docs/public/a' }), false)
    assert.equal(resourceIsMuted(p, { namespace: 'team', repo: 'data', type: 'file', id: 'docs/private/a' }), true)
  })

  await it('deduplicates audit capture and replays missed ledger appends durably', async () => {
    const first = audit({ message: 'SECRET_TOKEN', detail: { body: 'SECRET_BODY', error: 'SECRET_ERROR' } })
    await journal(first)
    await captureNotificationAudit(first)
    await replayNotificationAudit()
    await settled(reader, 1)
    assert.equal((await inbox()).items[0].count, 1)
    const second = audit()
    const seq = await journal(second)
    await replayNotificationAudit()
    await replayNotificationAudit()
    await settled(reader, 2)
    assert.equal((await inbox()).items[0].count, 2)
    assert(!JSON.stringify(await realNovu.feed(subscriberId(notificationUserKey(reader)))).includes('SECRET_'))
    assert(await getNotificationCursor() >= seq)
  })

  await it('refreshing a remembered user within a minute does not write again', async () => {
    const key = notificationUserKey(reader)
    const first = new Date(Date.now() - 10_000)
    await getDb().update(notificationUsers).set({ claimsAt: first }).where(eq(notificationUsers.userKey, key))
    await rememberNotificationUser(reader)
    assert.equal((await listNotificationUsers()).find((u) => u.key === key)!.claimsAt, first.toISOString())
    await getDb().update(notificationUsers).set({ claimsAt: new Date(Date.now() - 120_000) }).where(eq(notificationUsers.userKey, key))
    await rememberNotificationUser(reader)
    assert.ok(Date.parse((await listNotificationUsers()).find((u) => u.key === key)!.claimsAt) > Date.now() - 5_000)
  })

  await it('does not replay across later ACL mutations, while preserving explicit personal notices', async () => {
    const old = audit({ ts: new Date(Date.now() + 1).toISOString() })
    const grant = audit({ ts: new Date(Date.now() + 2).toISOString(), action: 'repo.collaborator.set', detail: { target: reader } })
    await journal(old)
    await journal(grant)
    await replayNotificationAudit()
    await settled(reader, 1)
    await new Promise((r) => setTimeout(r, 500))
    const items = (await inbox()).items
    assert.equal(items.length, 1)
    assert.equal(items[0].resource, undefined)
  })

  await it('keeps the cursor still when Novu fails, so the event is delivered once it recovers', async () => {
    const e = audit()
    const seq = await journal(e)
    useNovu({ ...realNovu, trigger: async () => { throw new Error('Novu unreachable') } })
    await assert.rejects(replayNotificationAudit(), /Novu unreachable/)
    assert((await getNotificationCursor()) < seq)
    useNovu(realNovu)
    await replayNotificationAudit()
    await settled(reader, 1)
    assert.equal((await inbox()).items.length, 1)
  })

  await it('hides deleted resources and ignores events older than the 90-day retention', async () => {
    await event()
    await settled(reader, 1)
    await captureNotificationAudit(audit({ action: 'repo.delete' }))
    assert.equal((await inbox()).items.length, 0)
    await event({ createdAt: new Date(Date.now() - 91 * 86_400_000).toISOString(), resource: { namespace: 'team', repo: 'other' } })
    await new Promise((r) => setTimeout(r, 500))
    assert.equal((await realNovu.feed(subscriberId(notificationUserKey(reader)))).length, 1)
  })

  await it('ignores HTTP failures and maps only allowlisted safe mutation summaries', async () => {
    assert.equal(await notificationFromAudit(audit({ status: 403 })), undefined)
    assert.equal(await notificationFromAudit(audit({ action: 'unknown' })), undefined)
    assert.equal(await notificationFromAudit(audit({ method: 'GET' })), undefined)
    const token = (await notificationFromAudit(audit({ action: 'token.create', detail: { target: reader, token: 'SECRET' } })))!
    assert.equal(token.category, 'security')
    assert.equal(token.resource, undefined)
    assert(!JSON.stringify(token).includes('SECRET'))
    assert.equal((await notificationFromAudit(audit({ action: 'commit.publish' })))?.category, 'repositories')
  })
})
