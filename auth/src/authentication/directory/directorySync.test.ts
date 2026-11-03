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
const { rememberNotificationUser, subscriberId } = await import('../../notifications.js')
const { notificationUserKey } = await import('../../notificationsStore.js')
const { useNovu } = await import('../../novu.js')
const { purgeTouchedSubscribers } = await import('../../novu.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { issueCliCredential } = await import('../credentials/cliCredentials.js')
const { queryAudit } = await import('../../audit.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { env, overrideEnv } = await import('../../env.js')
overrideEnv({
  directoryProvider: 'keycloak',
  keycloakAdminUrl: 'http://localhost:8180',
  keycloakRealm: 'mice',
  oidcClientId: 'mice-auth',
  oidcClientSecret: 'mice-auth-secret',
  oidcIssuerPublic: 'idp',
})
const { setDirectoryFetchForTests } = await import('./directory.js')
setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
})

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
await ensureBootstrapKey()
const cookie = async (sub: string, startSec: number) => {
  const sessionId = await sealSession({ ...mk(sub), sessionStart: startSec })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

await describe('directory sync', async () => {
  await it('revokes disabled and removed Principals (Sessions and CLI credentials), leaves enabled ones', async () => {
    at(t0)
    const sec = t0 / 1000
    const users = ['dis', 'gone', 'ok'] as const
    const creds = Object.fromEntries(await Promise.all(users.map(async (u) => [u, (await issueCliCredential(mk(u))).accessToken])))
    const sessions = Object.fromEntries(await Promise.all(users.map(async (u) => [u, await cookie(u, sec - 5)])))
    at(t0 + 60_000)
    const status = { dis: 'disabled', gone: 'missing', ok: 'enabled' } as const
    const result = await runDirectorySync({ lookup: async (p) => status[p.sub as keyof typeof status] ?? 'enabled' })
    assert.equal(result.ok, true)
    for (const u of ['dis', 'gone'] as const) {
      assert.equal((await app.request('/whoami', { headers: { cookie: sessions[u] } })).status, 401, `${u} session`)
      assert.equal((await app.request('/whoami', { headers: { authorization: `Bearer ${creds[u]}` } })).status, 401, `${u} credential`)
    }
    assert.equal((await app.request('/whoami', { headers: { cookie: sessions.ok } })).status, 200)
    assert.equal((await app.request('/whoami', { headers: { authorization: `Bearer ${creds.ok}` } })).status, 200)
    const ev = (await queryAudit({ actor: 'dis', action: 'session.revoke' })).events[0]
    assert.equal(ev?.detail?.source, 'directory-sync')
  })

  await it('revokes nobody and audits when the directory is unreachable', async () => {
    at(t0)
    const { accessToken } = await issueCliCredential(mk('out'))
    at(t0 + 60_000)
    const result = await runDirectorySync({ lookup: async () => 'error' })
    assert.equal(result.ok, false)
    assert.equal((await app.request('/whoami', { headers: { authorization: `Bearer ${accessToken}` } })).status, 200)
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
  const triggered: Array<{ subscriberId: string; title: string }> = []
  useNovu({
    async trigger(id, _eventId, payload) {
      triggered.push({ subscriberId: id, title: String((payload as { title?: string }).title ?? '') })
    },
    async feed() { return [] },
    async mark() {},
    async deleteSubscriber() {},
    async health() { return { ok: true } },
  })
  const received = (sub: string) =>
    triggered.filter((n) => n.title === 'Directory sync is stale' && n.subscriberId === subscriberId(notificationUserKey(mk(sub)))).length

  await it('alerts admins once past 2x the interval, clears on success, re-alerts when stale again', async () => {
    await rememberNotificationUser(mk('root'))
    await rememberNotificationUser(mk('plain'))
    at(t0 + 10_000_000)
    await runDirectorySync({ lookup: async () => 'enabled' })

    at(t0 + 10_000_000 + 2 * INTERVAL * 1000 - 1000)
    assert.equal(await checkDirectorySyncStale(INTERVAL), false)
    assert.equal(received('root'), 0)

    at(t0 + 10_000_000 + 2 * INTERVAL * 1000 + 1000)
    assert.equal(await checkDirectorySyncStale(INTERVAL), true)
    assert.equal(received('root'), 1)
    assert.equal(received('plain'), 0)
    assert.ok((await queryAudit({ action: 'directory.sync.stale' })).events.length >= 1)

    at(t0 + 10_000_000 + 3 * INTERVAL * 1000)
    assert.equal(await checkDirectorySyncStale(INTERVAL), false, 'not repeated while still stale')
    assert.equal(received('root'), 1)

    await runDirectorySync({ lookup: async () => 'enabled' })
    at(t0 + 10_000_000 + 6 * INTERVAL * 1000)
    assert.equal(await checkDirectorySyncStale(INTERVAL), true, 're-alerts after a later stale spell')
    assert.equal(received('root'), 2)
  })
})

