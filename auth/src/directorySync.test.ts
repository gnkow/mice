import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-dirsync-'))
process.env.SESSION_SECRET = 'test-secret-dirsync'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'
process.env.OIDC_ISSUER_PUBLIC = 'idp'

const { Hono } = await import('hono')
const { applyGlobalGuards, requireAuth } = await import('./requireAuth.js')
const { runDirectorySync, makeDirectorySyncRoute, checkDirectorySyncStale } = await import('./directorySync.js')
const { rememberNotificationUser } = await import('./notifications.js')
const { readNotificationState, notificationUserKey } = await import('./notificationsStore.js')
const { sealSession } = await import('./session.js')
const { createPat } = await import('./tokens.js')
const { queryAudit } = await import('./audit.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzStore.js')
const { env } = await import('./env.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })

const app = new Hono()
applyGlobalGuards(app)
app.get('/whoami', async (c) => {
  const a = await requireAuth(c)
  return a ? c.json({ via: a.via }) : c.json({}, 401)
})

const realNow = Date.now
afterEach(() => { Date.now = realNow })
const at = (ms: number) => { Date.now = () => ms }
const t0 = Math.floor(realNow() / 1000) * 1000
const cookie = async (sub: string, startSec: number) =>
  `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: startSec })}`

describe('directory sync', () => {
  it('revokes disabled and removed Principals (Sessions and PATs), leaves enabled ones', async () => {
    at(t0)
    const sec = t0 / 1000
    const users = ['dis', 'gone', 'ok'] as const
    const pats = Object.fromEntries(users.map((u) => [u, createPat(mk(u), 'cli').token]))
    const sessions = Object.fromEntries(await Promise.all(users.map(async (u) => [u, await cookie(u, sec - 5)])))
    at(t0 + 60_000)
    const status = { dis: 'disabled', gone: 'missing', ok: 'enabled' } as const
    const result = await runDirectorySync({ lookup: async (p) => status[p.sub as keyof typeof status] ?? 'enabled' })
    assert.equal(result.ok, true)
    for (const u of ['dis', 'gone'] as const) {
      assert.equal((await app.request('/whoami', { headers: { cookie: sessions[u] } })).status, 401, `${u} session`)
      assert.equal((await app.request('/whoami', { headers: { authorization: `Bearer ${pats[u]}` } })).status, 401, `${u} pat`)
    }
    assert.equal((await app.request('/whoami', { headers: { cookie: sessions.ok } })).status, 200)
    assert.equal((await app.request('/whoami', { headers: { authorization: `Bearer ${pats.ok}` } })).status, 200)
    const ev = queryAudit({ actor: 'dis', action: 'session.revoke' }).events[0]
    assert.equal(ev?.detail?.source, 'directory-sync')
  })

  it('revokes nobody and audits when the directory is unreachable', async () => {
    at(t0)
    const { token } = createPat(mk('out'), 'cli')
    at(t0 + 60_000)
    const result = await runDirectorySync({ lookup: async () => 'error' })
    assert.equal(result.ok, false)
    assert.equal((await app.request('/whoami', { headers: { authorization: `Bearer ${token}` } })).status, 200)
    assert.ok(queryAudit({ action: 'directory.sync.failed' }).events.length >= 1)
  })

  it('lets an instance admin trigger a run and refuses others', async () => {
    let runs = 0
    const route = makeDirectorySyncRoute(async () => { runs++; return { ok: true, checked: 0, revoked: [] } })
    const guarded = new Hono()
    applyGlobalGuards(guarded)
    guarded.post('/sync', route)
    const post = async (sub: string) =>
      guarded.request('/sync', {
        method: 'POST',
        headers: { cookie: await cookie(sub, Math.floor(realNow() / 1000) - 5), origin: 'http://localhost', host: 'localhost' },
      })
    assert.equal((await post('root')).status, 200)
    assert.equal(runs, 1)
    assert.equal((await post('nobody')).status, 403)
    assert.equal(runs, 1)
  })
})

describe('stale directory-sync alert', () => {
  const INTERVAL = 900
  const received = (sub: string) =>
    readNotificationState().entries.filter((e) => e.user === notificationUserKey(mk(sub)) &&
      readNotificationState().events[e.event]?.title === 'Directory sync is stale').length

  it('alerts admins once past 2x the interval, clears on success, re-alerts when stale again', async () => {
    rememberNotificationUser(mk('root'))
    rememberNotificationUser(mk('plain'))
    at(t0 + 10_000_000)
    await runDirectorySync({ lookup: async () => 'enabled' })

    at(t0 + 10_000_000 + 2 * INTERVAL * 1000 - 1000)
    assert.equal(checkDirectorySyncStale(INTERVAL), false)
    assert.equal(received('root'), 0)

    at(t0 + 10_000_000 + 2 * INTERVAL * 1000 + 1000)
    assert.equal(checkDirectorySyncStale(INTERVAL), true)
    assert.equal(received('root'), 1)
    assert.equal(received('plain'), 0)
    assert.ok(queryAudit({ action: 'directory.sync.stale' }).events.length >= 1)

    at(t0 + 10_000_000 + 3 * INTERVAL * 1000)
    assert.equal(checkDirectorySyncStale(INTERVAL), false, 'not repeated while still stale')
    assert.equal(received('root'), 1)

    await runDirectorySync({ lookup: async () => 'enabled' })
    at(t0 + 10_000_000 + 6 * INTERVAL * 1000)
    assert.equal(checkDirectorySyncStale(INTERVAL), true, 're-alerts after a later stale spell')
    assert.equal(received('root'), 2)
  })
})

