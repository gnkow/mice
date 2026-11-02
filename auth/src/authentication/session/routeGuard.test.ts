import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-guard-'))
process.env.SESSION_SECRET = 'test-session-secret-for-guard'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { Hono } = await import('hono')
const { guarded } = await import('./routeGuard.js')
const { sealSession } = await import('./session.js')
const { sealSessionCookie } = await import('./cookieSeal.js')
const { ensureBootstrapKey } = await import('./sealKeys.js')
const { issueCliCredential } = await import('../credentials/cliCredentials.js')
const { maybeBootstrapInstanceAdmin, isInstanceAdmin } = await import('../../authzInstanceStore.js')
const { env, overrideEnv } = await import('../../env.js')
overrideEnv({
  directoryProvider: 'keycloak',
  keycloakAdminUrl: 'http://localhost:8180',
  keycloakRealm: 'mice',
  oidcClientId: 'mice-auth',
  oidcClientSecret: 'mice-auth-secret',
  oidcIssuerPublic: 'http://localhost:8180/realms/mice',
})
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
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
await ensureBootstrapKey()
const cookie = async (sub: string) => {
  const sessionId = await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return { cookie: `${env.cookieName}=${await sealSessionCookie(sessionId)}` }
}
const json = { 'content-type': 'application/json' }

const app = new Hono()
app.post(
  '/admin',
  guarded(
    { gate: async (u) => (await isInstanceAdmin(u) ? null : 'Forbidden'), body: { required: ['sub', 'iss'] } },
    ({ user, body, via }) => Response.json({ by: user.sub, via, target: body }),
  ),
)
app.get('/me', guarded({ credential: 'session' }, ({ user }) => Response.json({ sub: user.sub })))
app.post('/optional', guarded({ body: 'optional' }, ({ body }) => Response.json({ body })))

await describe('route guard', async () => {
  await it('answers 401 without credentials', async () => {
    assert.equal((await app.request('/me')).status, 401)
  })

  await it('honours the credential policy', async () => {
    const { accessToken } = await issueCliCredential(mk('p'))
    assert.equal((await app.request('/me', { headers: { authorization: `Bearer ${accessToken}` } })).status, 401)
    assert.equal((await app.request('/me', { headers: await cookie('p') })).status, 200)
  })

  await it('answers 403 with the gate message, before reading the body', async () => {
    const r = await app.request('/admin', { method: 'POST', headers: { ...(await cookie('nobody')), ...json }, body: 'not json' })
    assert.equal(r.status, 403)
    assert.deepEqual(await r.json(), { error: 'Forbidden' })
  })

  await it('answers 400 for an invalid or incomplete body', async () => {
    const h = { ...(await cookie('root')), ...json }
    const bad = await app.request('/admin', { method: 'POST', headers: h, body: 'nope' })
    assert.deepEqual([bad.status, await bad.json()], [400, { error: 'Invalid body' }])
    const missing = await app.request('/admin', { method: 'POST', headers: h, body: JSON.stringify({ sub: 'x' }) })
    assert.deepEqual([missing.status, await missing.json()], [400, { error: 'sub and iss required' }])
  })

  await it('hands the handler a prepared Principal, via and the parsed body', async () => {
    const r = await app.request('/admin', { method: 'POST', headers: { ...(await cookie('root')), ...json }, body: JSON.stringify({ sub: 'x', iss: 'idp' }) })
    assert.deepEqual(await r.json(), { by: 'root', via: 'session', target: { sub: 'x', iss: 'idp' } })
  })

  await it('treats an empty body as {} when optional', async () => {
    const r = await app.request('/optional', { method: 'POST', headers: await cookie('root') })
    assert.deepEqual(await r.json(), { body: {} })
  })
})
