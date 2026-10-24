import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { Hono } from 'hono'
import webpush from 'web-push'
import type { SessionUser } from './session.js'
import type { AuditEvent } from './audit.js'

// Keep test artifacts in the project, never in a system temporary directory.
const dataDir = resolve(`.notifications-test-${randomUUID()}`)
mkdirSync(dataDir, { mode: 0o700 })
process.env.AUTH_DATA_DIR = dataDir
process.env.SESSION_SECRET = 'notification-test-session-secret'
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@notifications.test'
process.env.AUTHZ_GROUP_BOOTSTRAP = '{}'
process.env.PUBLIC_WEB_ORIGIN = 'http://localhost'

const {
  captureNotificationAudit, emitNotification, notificationFromAudit, parseNotificationSubscription,
  registerNotificationRoutes, rememberNotificationUser, replayNotificationAudit, runNotificationWorkerOnce,
  startNotificationWorker,
} = await import('./notifications.js')
const {
  notificationAuditPath, notificationStorePath, notificationTransaction, notificationUserKey, readNotificationState,
} = await import('./notificationsStore.js')
const {
  defaultNotificationPreferences, nextNotificationDelivery, notificationQuiet, parseNotificationPreferences, resourceIsMuted,
} = await import('./notificationsTypes.js')
const { sealSession } = await import('./session.js')
const {
  createNamespaceAuthz, setRepoCollaborator, removeRepoCollaborator, setRepoGroupCollaborator,
} = await import('./authzStore.js')
const { preparePrincipal } = await import('./authz.js')

const admin: SessionUser = { iss: 'https://idp.test', sub: 'admin', email: 'admin@notifications.test', emailVerified: true, name: 'Admin' }
const reader: SessionUser = { iss: admin.iss, sub: 'reader', email: 'reader@notifications.test', name: 'Reader' }
const outsider: SessionUser = { iss: admin.iss, sub: 'outsider', email: 'other@notifications.test', name: 'Other' }
const app = new Hono()
registerNotificationRoutes(app)
const originalPush = webpush.sendNotification

async function request(path = '', method = 'GET', body?: unknown, user: SessionUser | null = reader, origin = 'http://localhost') {
  const headers: Record<string, string> = { origin }
  if (user) headers.cookie = `mice_session=${await sealSession(user)}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return app.request(`http://localhost/auth/notifications${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function inbox(user = reader) {
  const response = await request('', 'GET', undefined, user)
  assert.equal(response.status, 200)
  return response.json() as Promise<{ items: Array<{ id: string; count: number; read: boolean; createdAt: string; resource?: unknown }>; unreadCount: number; nextCursor?: string }>
}
function event(overrides: Partial<Parameters<typeof emitNotification>[0]> = {}) {
  emitNotification({
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
function enable(channel: 'email' | 'push') {
  const p = defaultNotificationPreferences()
  p.categories.files[channel] = true
  notificationTransaction((s) => { s.preferences[notificationUserKey(reader)] = p })
  return p
}
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device',
  keys: { auth: Buffer.alloc(16, 1).toString('base64url'), p256dh: Buffer.alloc(65, 4).toString('base64url') },
}

beforeEach(() => {
  rmSync(notificationStorePath(), { force: true })
  rmSync(notificationAuditPath(), { force: true })
  delete process.env.NOTIFICATIONS_SMTP_URL
  delete process.env.NOTIFICATIONS_EMAIL_FROM
  delete process.env.NOTIFICATIONS_VAPID_PUBLIC_KEY
  delete process.env.NOTIFICATIONS_VAPID_PRIVATE_KEY
  delete process.env.NOTIFICATIONS_VAPID_SUBJECT
  webpush.sendNotification = originalPush
  preparePrincipal(admin)
  createNamespaceAuthz(admin, 'team', 'none')
  setRepoCollaborator('team', 'data', reader, 'read')
  removeRepoCollaborator('team', 'data', outsider)
  rememberNotificationUser({ ...admin, idToken: 'NEVER_PERSIST_ID_TOKEN', patScopes: undefined })
  rememberNotificationUser(reader)
  rememberNotificationUser(outsider)
})
after(() => { webpush.sendNotification = originalPush; rmSync(dataDir, { recursive: true, force: true }) })

describe('notification authorization, inbox and API', () => {
  it('is session-only, self-scoped, CSRF protected and rejects malformed requests', async () => {
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

  it('persists safe offline identities and suppresses actor echoes and unauthorized readers', async () => {
    event()
    assert.equal((await inbox(reader)).items.length, 1)
    assert.equal((await inbox(admin)).items.length, 0)
    assert.equal((await inbox(outsider)).items.length, 0)
    const serialized = readFileSync(notificationStorePath(), 'utf8')
    assert(!serialized.includes('NEVER_PERSIST_ID_TOKEN'))
    assert(!serialized.includes('patScopes'))
    removeRepoCollaborator('team', 'data', reader)
    assert.equal((await inbox(reader)).unreadCount, 0)
    assert.equal((await request('/unread-count')).status, 200)
  })

  it('does not backfill resource events to newly registered users but stores explicit personal targets', async () => {
    const newcomer = { ...reader, sub: 'newcomer' }
    setRepoCollaborator('team', 'data', newcomer, 'read')
    event()
    emitNotification({
      id: 'personal-new', category: 'access', title: 'Access changed', summary: 'Your access changed.',
      recipients: [newcomer], audience: 'personal',
    })
    rememberNotificationUser(newcomer)
    const result = await inbox(newcomer)
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].resource, undefined)
    event()
    assert.equal((await inbox(newcomer)).items.length, 2)
  })

  it('groups constituents, reopens read groups, and applies read-all only through a cutoff', async () => {
    event()
    event()
    let result = await inbox()
    assert.equal(result.items[0].count, 2)
    assert.equal(result.unreadCount, 1)
    const id = result.items[0].id
    assert.equal((await request(`/${id}`, 'PATCH', { read: true })).status, 200)
    assert.equal((await inbox()).unreadCount, 0)
    event()
    result = await inbox()
    assert.equal(result.items[0].id, id)
    assert.equal(result.items[0].count, 3)
    assert.equal(result.unreadCount, 1)
    const cutoff = new Date().toISOString()
    event()
    notificationTransaction((s) => {
      s.entries.filter((row) => row.user === notificationUserKey(reader)).at(-1)!.receivedAt = new Date(Date.now() + 1000).toISOString()
    })
    assert.equal((await request('/read-all', 'POST', { before: cutoff })).status, 200)
    assert.equal((await inbox()).unreadCount, 1)
    assert.equal((await request(`/${id}`, 'PATCH', { read: false }, outsider)).status, 404)
  })

  it('supports unread filtering and stable opaque pagination', async () => {
    for (let i = 0; i < 55; i++) event({ category: 'security', recipients: [reader], audience: 'personal', resource: undefined })
    const first = await inbox()
    assert.equal(first.items.length, 50)
    assert(first.nextCursor)
    const second = await request(`?cursor=${first.nextCursor}&unread=1`)
    assert.equal((await second.json()).items.length, 5)
    assert.equal((await request('?cursor=garbage')).status, 400)
  })

  it('keeps private sessions and session metadata private; includes personal asynchronous outcomes', async () => {
    event({
      category: 'sessions', owner: reader, actor: reader, recipients: [reader],
      resource: { type: 'session', id: 'private' },
    })
    assert.equal((await inbox(reader)).items.length, 1)
    assert.equal((await inbox(outsider)).items.length, 0)
    setRepoCollaborator('team', 'data', outsider, 'read')
    event({
      category: 'metadata', owner: reader,
      resource: { namespace: 'team', repo: 'data', type: 'session', id: 'private' },
    })
    assert.equal((await inbox(outsider)).items.length, 0)
    assert.equal((await inbox(reader)).items.length, 2)
  })

  it('observes hierarchy, personal relevance, preferences and quiet-hour toast claiming', async () => {
    const p = defaultNotificationPreferences()
    p.resourceOverrides = [
      { resource: { namespace: 'team' }, mode: 'mute' },
      { resource: { namespace: 'team', repo: 'data', type: 'path', id: 'docs' }, mode: 'watch' },
    ]
    assert.equal((await request('/preferences', 'PATCH', p)).status, 200)
    event()
    event({ resource: { namespace: 'team', repo: 'data', type: 'path', id: 'hidden/a' } })
    assert.equal((await inbox()).items.length, 1)
    assert.equal((await (await request('/toast')).json()).items.length, 1)
    assert.equal((await (await request('/toast')).json()).items.length, 0)
    const now = new Date()
    p.quietHours = {
      enabled: true, start: now.toISOString().slice(11, 16),
      end: new Date(now.getTime() + 3_600_000).toISOString().slice(11, 16),
    }
    assert.equal((await request('/preferences', 'PATCH', p)).status, 200)
    event()
    assert.equal((await (await request('/toast')).json()).items.length, 0)
    assert.equal((await inbox()).items[0].count, 2)
    p.enabled = false
    await request('/preferences', 'PATCH', p)
    assert.equal((await inbox()).unreadCount, 0)
  })

  it('expires offline group snapshots and never stores PAT-scoped principals', async () => {
    const grouped = { ...outsider, groups: ['readers'] }
    setRepoGroupCollaborator('team', 'group-repo', 'readers', 'read')
    rememberNotificationUser(grouped)
    event({ resource: { namespace: 'team', repo: 'group-repo' } })
    assert.equal((await inbox(grouped)).items.length, 1)
    notificationTransaction((s) => { s.users[notificationUserKey(grouped)].claimsAt = new Date(Date.now() - 2 * 86_400_000).toISOString() })
    assert.equal((await inbox(grouped)).items.length, 0)
    rememberNotificationUser({ ...grouped, sub: 'pat-only', patScopes: [{ namespace: 'team', maxRole: 'read' }] })
    assert.equal(readNotificationState().users[notificationUserKey({ ...grouped, sub: 'pat-only' })], undefined)
  })

  it('announcements reach registered users and preserve channel defaults/availability', async () => {
    const response = await request('/announcements', 'POST', { title: 'Maintenance', summary: 'Scheduled downtime.' }, admin)
    assert.equal(response.status, 201)
    assert.equal((await inbox(reader)).items.length, 1)
    assert.equal((await inbox(outsider)).items.length, 1)
    const settings = await (await request('/preferences')).json()
    assert.deepEqual(settings.availability, { email: false, push: false })
    assert.equal(settings.preferences.categories.files.toast, true)
    assert.equal(settings.preferences.categories.files.email, false)
  })
})

describe('notification scheduling and recovery', () => {
  it('validates timezones, nearest resource overrides and DST-aware daily/weekly schedules', () => {
    const p = defaultNotificationPreferences()
    p.timezone = 'America/New_York'
    p.quietHours = { enabled: true, start: '22:00', end: '08:00' }
    assert(notificationQuiet(p, new Date('2026-03-08T06:59:00Z')))
    assert.equal(new Date(nextNotificationDelivery(p, 'push', Date.parse('2026-03-08T06:59:00Z'))).toISOString(), '2026-03-08T12:00:00.000Z')
    p.emailSchedule = 'daily'
    assert.equal(new Date(nextNotificationDelivery(p, 'email', Date.parse('2026-03-08T06:59:00Z'))).toISOString(), '2026-03-08T13:00:00.000Z')
    p.emailSchedule = 'weekly'
    assert.equal(new Date(nextNotificationDelivery(p, 'email', Date.parse('2026-03-08T06:59:00Z'))).toISOString(), '2026-03-09T13:00:00.000Z')
    p.quietHours = { enabled: true, start: '08:00', end: '12:00' }
    assert.equal(new Date(nextNotificationDelivery(p, 'email', Date.parse('2026-03-08T06:59:00Z'))).toISOString(), '2026-03-09T16:00:00.000Z')
    assert.throws(() => parseNotificationPreferences({ ...p, timezone: 'Not/AZone' }))
    p.resourceOverrides = [
      { resource: { namespace: 'team' }, mode: 'mute' },
      { resource: { namespace: 'team', repo: 'data', type: 'directory', id: 'docs' }, mode: 'watch' },
      { resource: { namespace: 'team', repo: 'data', type: 'path', id: 'docs/private' }, mode: 'mute' },
    ]
    assert.equal(resourceIsMuted(p, { namespace: 'team', repo: 'data', type: 'file', id: 'docs/public/a' }), false)
    assert.equal(resourceIsMuted(p, { namespace: 'team', repo: 'data', type: 'file', id: 'docs/private/a' }), true)
  })

  it('deduplicates audit capture and replays missed journal appends durably', async () => {
    const first = audit({ message: 'SECRET_TOKEN', detail: { body: 'SECRET_BODY', error: 'SECRET_ERROR' } })
    appendFileSync(notificationAuditPath(), `${JSON.stringify(first)}\n`)
    captureNotificationAudit(first)
    replayNotificationAudit()
    assert.equal((await inbox()).items[0].count, 1)
    const second = audit()
    appendFileSync(notificationAuditPath(), `${JSON.stringify(second)}\n`)
    replayNotificationAudit()
    replayNotificationAudit()
    assert.equal((await inbox()).items[0].count, 2)
    const state = readFileSync(notificationStorePath(), 'utf8')
    assert(!state.includes('SECRET_'))
    assert.equal(readNotificationState().auditOffset, Buffer.byteLength(readFileSync(notificationAuditPath())))
  })

  it('does not replay across later ACL mutations, while preserving explicit personal notices', async () => {
    const old = audit({ ts: new Date(Date.now() + 1).toISOString() })
    const grant = audit({ ts: new Date(Date.now() + 2).toISOString(), action: 'repo.collaborator.set', detail: { target: reader } })
    appendFileSync(notificationAuditPath(), `${JSON.stringify(old)}\n${JSON.stringify(grant)}\n`)
    replayNotificationAudit()
    assert.equal((await inbox()).items.length, 1)
    assert.equal((await inbox()).items[0].resource, undefined)
  })

  it('strictly fails corrupt persisted state and malformed journal lines without acknowledging them', async () => {
    writeFileSync(notificationStorePath(), '{broken')
    assert.throws(() => readNotificationState(), SyntaxError)
    assert.equal((await request('/preferences')).status, 503)
    rmSync(notificationStorePath())
    rememberNotificationUser(reader)
    appendFileSync(notificationAuditPath(), '{invalid}\n')
    const offset = readNotificationState().auditOffset
    assert.throws(() => replayNotificationAudit(), SyntaxError)
    assert.equal(readNotificationState().auditOffset, offset)
    await assert.rejects(runNotificationWorkerOnce(), SyntaxError)
  })

  it('hides deleted resources and removes all 90-day-old constituents/deliveries', async () => {
    enable('email')
    event()
    captureNotificationAudit(audit({ action: 'repo.delete' }))
    assert.equal((await inbox()).items.length, 0)
    notificationTransaction((s) => {
      for (const e of Object.values(s.events)) e.createdAt = new Date(Date.now() - 91 * 86_400_000).toISOString()
    })
    await runNotificationWorkerOnce()
    const s = readNotificationState()
    assert.equal(Object.keys(s.events).length, 0)
    assert.equal(s.entries.length, 0)
    assert.equal(s.deliveries.length, 0)
  })

  it('ignores HTTP failures and maps only allowlisted safe mutation summaries', () => {
    assert.equal(notificationFromAudit(audit({ status: 403 })), undefined)
    assert.equal(notificationFromAudit(audit({ action: 'unknown' })), undefined)
    assert.equal(notificationFromAudit(audit({ method: 'GET' })), undefined)
    const token = notificationFromAudit(audit({ action: 'token.create', detail: { target: reader, token: 'SECRET' } }))!
    assert.equal(token.category, 'security')
    assert.equal(token.resource, undefined)
    assert(!JSON.stringify(token).includes('SECRET'))
    assert.equal(notificationFromAudit(audit({ action: 'commit.publish' }))?.category, 'repositories')
  })
})

describe('external delivery and durable retry', () => {
  it('delivers immediate and digest mail through a real local SMTP test double', async () => {
    const messages: string[] = []
    const server = createServer((socket) => {
      socket.write('220 test.local ESMTP\r\n')
      let pending = ''
      let data = false
      let message = ''
      socket.on('data', (chunk) => {
        pending += chunk.toString()
        let end: number
        while ((end = pending.indexOf('\r\n')) >= 0) {
          const line = pending.slice(0, end)
          pending = pending.slice(end + 2)
          if (data) {
            if (line === '.') { data = false; messages.push(message); message = ''; socket.write('250 accepted\r\n') }
            else message += `${line}\n`
          } else if (/^EHLO|^HELO/.test(line)) socket.write('250 test.local\r\n')
          else if (/^DATA/.test(line)) { data = true; socket.write('354 End with dot\r\n') }
          else if (/^QUIT/.test(line)) { socket.end('221 bye\r\n') }
          else socket.write('250 OK\r\n')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      process.env.NOTIFICATIONS_SMTP_URL = `smtp://127.0.0.1:${address.port}`
      process.env.NOTIFICATIONS_EMAIL_FROM = 'MICE <mice@notifications.test>'
      const p = enable('email')
      event()
      await runNotificationWorkerOnce()
      assert.equal(messages.length, 1)
      assert(messages[0].includes('reader@notifications.test'))
      assert.equal(readNotificationState().deliveries[0].state, 'sent')
      p.emailSchedule = 'daily'
      notificationTransaction((s) => { s.preferences[notificationUserKey(reader)] = p })
      event()
      event()
      notificationTransaction((s) => { for (const d of s.deliveries) if (d.state === 'pending') d.due = Date.now() - 1 })
      await runNotificationWorkerOnce()
      assert.equal(messages.length, 2)
      assert(messages[1].includes('2 notifications'))
    } finally { await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())) }
  })

  it('reports transport failures, persists exponential backoff, recovers leases and cancels revoked dispatch', async () => {
    enable('email')
    event()
    await runNotificationWorkerOnce()
    let delivery = readNotificationState().deliveries[0]
    assert.equal(delivery.state, 'pending')
    assert.equal(delivery.attempts, 1)
    assert(delivery.due > Date.now())
    assert.equal(delivery.lastError, 'delivery_failed')
    notificationTransaction((s) => {
      const d = s.deliveries[0]
      d.state = 'sending'; d.lease = 'crashed-process'; d.leaseUntil = Date.now() - 1; d.due = Date.now() - 1
    })
    await runNotificationWorkerOnce()
    delivery = readNotificationState().deliveries[0]
    assert.equal(delivery.attempts, 2)
    removeRepoCollaborator('team', 'data', reader)
    notificationTransaction((s) => { s.deliveries[0].due = Date.now() - 1 })
    await runNotificationWorkerOnce()
    assert.equal(readNotificationState().deliveries[0].state, 'cancelled')
    const stop = startNotificationWorker()
    stop()
  })

  it('registers unique push ownership, rejects SSRF endpoints, sends real Web Push payloads and prunes 410 subscriptions', async () => {
    assert.throws(() => parseNotificationSubscription({ ...subscription, endpoint: 'http://127.0.0.1/private' }))
    assert.throws(() => parseNotificationSubscription({ ...subscription, endpoint: 'https://fcm.googleapis.com.evil.test/x' }))
    assert.throws(() => parseNotificationSubscription({ ...subscription, endpoint: 'https://fcm.googleapis.com:8443/x' }))
    assert.equal((await request('/push-subscriptions', 'POST', subscription)).status, 201)
    assert.equal((await request('/push-subscriptions', 'POST', subscription, outsider)).status, 201)
    assert.equal(readNotificationState().subscriptions[notificationUserKey(reader)].length, 0)
    await request('/push-subscriptions', 'POST', subscription)
    const keys = webpush.generateVAPIDKeys()
    process.env.NOTIFICATIONS_VAPID_PUBLIC_KEY = keys.publicKey
    process.env.NOTIFICATIONS_VAPID_PRIVATE_KEY = keys.privateKey
    process.env.NOTIFICATIONS_VAPID_SUBJECT = 'mailto:admin@notifications.test'
    let payload = ''
    webpush.sendNotification = async (_s, body) => { payload = String(body); return { statusCode: 201, body: '', headers: {} } }
    enable('push')
    event()
    await runNotificationWorkerOnce()
    assert.equal(JSON.parse(payload).title, 'Files changed')
    assert.equal(readNotificationState().deliveries[0].state, 'sent')
    webpush.sendNotification = async () => { throw Object.assign(new Error('expired'), { statusCode: 410 }) }
    event()
    await runNotificationWorkerOnce()
    assert.equal(readNotificationState().subscriptions[notificationUserKey(reader)].length, 0)
    assert.equal((await request('/push-subscriptions', 'DELETE', { endpoint: subscription.endpoint })).status, 200)
  })

  it('keeps inbox immediate but schedules quiet-hour channels later', async () => {
    const p = enable('email')
    const now = new Date()
    p.quietHours = { enabled: true, start: now.toISOString().slice(11, 16), end: new Date(now.getTime() + 3_600_000).toISOString().slice(11, 16) }
    notificationTransaction((s) => { s.preferences[notificationUserKey(reader)] = p })
    event()
    assert.equal((await inbox()).unreadCount, 1)
    assert(readNotificationState().deliveries[0].due > Date.now())
    await runNotificationWorkerOnce()
    assert.equal(readNotificationState().deliveries[0].attempts, 0)
  })
})
