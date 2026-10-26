import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-dirsync-'))
process.env.SESSION_SECRET = 'test-secret-dirsync'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'
process.env.OIDC_ISSUER_PUBLIC = 'idp'

const { Hono } = await import('hono')
const { applyGlobalGuards, authenticateRequest } = await import('../session/requireAuth.js')
const { runDirectorySync, makeDirectorySyncRoute, checkDirectorySyncStale } = await import('./directorySync.js')
const { rememberNotificationUser } = await import('../../notifications.js')
const { novuInbox } = await import('../../testSupport.js')
const { purgeTouchedSubscribers } = await import('../../novu.js')
const { sealSession } = await import('../session/session.js')
const { createPat } = await import('../credentials/tokens.js')
const { queryAudit } = await import('../../audit.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { env } = await import('../../env.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
await maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })

const app = new Hono()
applyGlobalGuards(app)
app.get('/whoami', async (c) => {
  const a = await authenticateRequest(c, { allowScoped: true })
  return a ? c.json({ via: a.via }) : c.json({}, 401)
})

const realNow = Date.now
afterEach(() => { Date.now = realNow })
const at = (ms: number) => { Date.now = () => ms }
const t0 = Math.floor(realNow() / 1000) * 1000
const cookie = async (sub: string, startSec: number) =>
  `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: startSec })}`

await describe('directory sync', async () => {
  await it('revokes disabled and removed Principals (Sessions and PATs), leaves enabled ones', async () => {
    at(t0)
    const sec = t0 / 1000
    const users = ['dis', 'gone', 'ok'] as const
    const pats = Object.fromEntries(await Promise.all(users.map(async (u) => [u, (await createPat(mk(u), 'cli')).token])))
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
    const ev = (await queryAudit({ actor: 'dis', action: 'session.revoke' })).events[0]
    assert.equal(ev?.detail?.source, 'directory-sync')
  })

  await it('revokes nobody and audits when the directory is unreachable', async () => {
    at(t0)
    const { token } = await createPat(mk('out'), 'cli')
    at(t0 + 60_000)
    const result = await runDirectorySync({ lookup: async () => 'error' })
    assert.equal(result.ok, false)
    assert.equal((await app.request('/whoami', { headers: { authorization: `Bearer ${token}` } })).status, 200)
    assert.ok((await queryAudit({ action: 'directory.sync.failed' })).events.length >= 1)
  })

  await it('lets an instance admin trigger a run and refuses others', async () => {
    let runs = 0
    const route = makeDirectorySyncRoute(async () => { runs++; return { ok: true, checked: 0, revoked: [], incomplete: [] } })
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

await describe('stale directory-sync alert', async () => {
  const INTERVAL = 900
  after(purgeTouchedSubscribers)
  const received = async (sub: string, expect = 0) =>
    (await novuInbox(mk(sub), expect)).filter((n) => n.title === 'Directory sync is stale').length

  await it('alerts admins once past 2x the interval, clears on success, re-alerts when stale again', async () => {
    await rememberNotificationUser(mk('root'))
    await rememberNotificationUser(mk('plain'))
    at(t0 + 10_000_000)
    await runDirectorySync({ lookup: async () => 'enabled' })

    at(t0 + 10_000_000 + 2 * INTERVAL * 1000 - 1000)
    assert.equal(await checkDirectorySyncStale(INTERVAL), false)
    assert.equal(await received('root'), 0)

    at(t0 + 10_000_000 + 2 * INTERVAL * 1000 + 1000)
    assert.equal(await checkDirectorySyncStale(INTERVAL), true)
    assert.equal(await received('root', 1), 1)
    assert.equal(await received('plain'), 0)
    assert.ok((await queryAudit({ action: 'directory.sync.stale' })).events.length >= 1)

    at(t0 + 10_000_000 + 3 * INTERVAL * 1000)
    assert.equal(await checkDirectorySyncStale(INTERVAL), false, 'not repeated while still stale')
    assert.equal(await received('root', 1), 1)

    await runDirectorySync({ lookup: async () => 'enabled' })
    at(t0 + 10_000_000 + 6 * INTERVAL * 1000)
    assert.equal(await checkDirectorySyncStale(INTERVAL), true, 're-alerts after a later stale spell')
    assert.equal(await received('root', 2), 2)
  })
})

