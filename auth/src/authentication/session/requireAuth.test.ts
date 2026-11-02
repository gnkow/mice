import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-wiring-'))
process.env.SESSION_SECRET = 'test-session-secret-for-wiring'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { Hono } = await import('hono')
const { applyGlobalGuards, authenticateRequest, setAuthenticationObserver } = await import('./requireAuth.js')
const { sealSession } = await import('./session.js')
const { sealSessionCookie } = await import('./cookieSeal.js')
const { ensureBootstrapKey } = await import('./sealKeys.js')
const { issueCliCredential } = await import('../credentials/cliCredentials.js')
const { offboard } = await import('../credentials/offboarding.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
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

const adminRevoke = (actor: { iss: string; sub: string }, target: { iss: string; sub: string }) =>
  offboard(target, { scope: 'all', cause: 'admin-revocation', actor: { ...actor, email: '', name: '' } })
const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
const root = mk('root')
await maybeBootstrapInstanceAdmin({ ...root, emailVerified: true })

const app = new Hono()
applyGlobalGuards(app)
app.all('/whoami', async (c) => {
  const authed = await authenticateRequest(c, { allowScoped: true })
  return authed ? c.json({ sub: authed.user.sub, via: authed.via }) : c.json({}, 401)
})

await ensureBootstrapKey()
const cookie = async (sub: string) => {
  const sessionId = await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

await describe('auth wiring (middleware order + requireAuth)', async () => {
  await it('prefers the session over a CLI credential when both are sent', async () => {
    const { accessToken } = await issueCliCredential(mk('bob'))
    const res = await app.request('/whoami', {
      headers: { cookie: await cookie('alice'), authorization: `Bearer ${accessToken}` },
    })
    assert.deepEqual(await res.json(), { sub: 'alice', via: 'session' })
  })

  await it('falls back to the CLI credential when the session is revoked', async () => {
    const { accessToken } = await issueCliCredential(mk('carol'))
    const stale = await cookie('dave')
    await adminRevoke(root, mk('dave'))
    const res = await app.request('/whoami', {
      headers: { cookie: stale, authorization: `Bearer ${accessToken}` },
    })
    assert.deepEqual(await res.json(), { sub: 'carol', via: 'pat' })
  })

  await it('is 401 with a revoked session and no CLI credential', async () => {
    const stale = await cookie('erin')
    await adminRevoke(root, mk('erin'))
    assert.equal((await app.request('/whoami', { headers: { cookie: stale } })).status, 401)
  })

  await it('rejects a cross-site write on a cookie session before the route runs', async () => {
    const res = await app.request('/whoami', {
      method: 'POST',
      headers: { cookie: await cookie('alice'), 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(res.status, 403)
  })

  await it('lets a cross-site write through when authenticated by a CLI credential', async () => {
    const { accessToken } = await issueCliCredential(mk('frank'))
    const res = await app.request('/whoami', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(res.status, 200)
  })
})

await describe('authentication observer', async () => {
  await it('sees each authenticated principal and stops after restore', async () => {
    const seen: string[] = []
    const restore = setAuthenticationObserver((u) => seen.push(u.sub))
    await app.request('/whoami', { headers: { cookie: await cookie('fay') } })
    await app.request('/whoami')
    assert.deepEqual(seen, ['fay'])
    restore()
    await app.request('/whoami', { headers: { cookie: await cookie('gus') } })
    assert.deepEqual(seen, ['fay'])
  })

  await it('restore puts back the previous observer', async () => {
    const outer: string[] = []
    const inner: string[] = []
    const restoreOuter = setAuthenticationObserver((u) => outer.push(u.sub))
    const restoreInner = setAuthenticationObserver((u) => inner.push(u.sub))
    restoreInner()
    await app.request('/whoami', { headers: { cookie: await cookie('hal') } })
    restoreOuter()
    assert.deepEqual([outer, inner], [['hal'], []])
  })
})
