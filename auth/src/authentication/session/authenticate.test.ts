import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-authn-'))
process.env.SESSION_SECRET = 'test-session-secret-for-authn'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'
const { Hono } = await import('hono')
const { authenticate, authenticateUser, authenticateRequest, setAuthenticationObserver } = await import('./requireAuth.js')
type Policy = NonNullable<Parameters<typeof authenticate>[1]>
const { sealSession } = await import('./session.js')
const { sealSessionCookie } = await import('./cookieSeal.js')
const { ensureBootstrapKey } = await import('./sealKeys.js')
const { issueCliCredential } = await import('../credentials/cliCredentials.js')
const { env } = await import('../../env.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  throw new Error(`Unexpected request: ${urlStr}`)
})
const { hasInstancePermission } = await import('../../authzInstanceStore.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
const appFor = (policy: Policy) => {
  const app = new Hono()
  app.all('/x', async (c) => {
    const r = await authenticate(c, policy)
    return r.ok ? c.json({ sub: r.user.sub, via: r.via }) : c.json({ error: r.error }, r.status)
  })
  return app
}
const cookie = async (sub: string) => {
  const sessionId = await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}
const scope = [{ namespace: 'ns', maxRole: 'read' as const }]
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

await ensureBootstrapKey()

await describe('authenticate', async () => {
  await it('accepts a cookie Session and a CLI credential, and refuses a personal access token', async () => {
    const app = appFor({})
    const { accessToken } = await issueCliCredential(mk('a'))
    assert.deepEqual(await (await app.request('/x', { headers: { cookie: await cookie('b') } })).json(), { sub: 'b', via: 'session' })
    assert.deepEqual(await (await app.request('/x', { headers: bearer(accessToken) })).json(), { sub: 'a', via: 'pat' })
    assert.equal((await app.request('/x', { headers: bearer('mice_pat_retired') })).status, 401)
    assert.equal((await app.request('/x')).status, 401)
  })

  await it('rejects a scoped CLI credential unless allowScoped', async () => {
    const { accessToken } = await issueCliCredential(mk('s'), scope)
    assert.equal((await appFor({}).request('/x', { headers: bearer(accessToken) })).status, 401)
    assert.equal((await appFor({ allowScoped: true }).request('/x', { headers: bearer(accessToken) })).status, 200)
  })

  await it('credential: session refuses a CLI credential', async () => {
    const { accessToken } = await issueCliCredential(mk('p'))
    assert.equal((await appFor({ credential: 'session' }).request('/x', { headers: bearer(accessToken) })).status, 401)
    assert.equal((await appFor({ credential: 'session' }).request('/x', { headers: { cookie: await cookie('p') } })).status, 200)
  })

  await it('accepts a human Session when the route requires favorites', async () => {
    await ensureBootstrapKey()
    const sessionId = await sealSession({ ...mk('fav'), sessionStart: Math.floor(Date.now() / 1000) - 30 })
    const headers = { cookie: `${env.cookieName}=${await sealSessionCookie(sessionId)}` }
    const res = await appFor({ requires: { capability: 'hasFavorites', message: 'no favorites' } }).request('/x', { headers })
    assert.equal(res.status, 200)
  })

  await it('checks Origin and content type for cookie Sessions on unsafe methods only', async () => {
    const app = appFor({ originCheck: true, jsonOnly: true })
    const c = await cookie('o')
    const post = (headers: Record<string, string>) => app.request('/x', { method: 'POST', headers: { cookie: c, ...headers } })
    assert.equal((await post({})).status, 403)
    assert.equal((await post({ origin: new URL(env.publicWebOrigin).origin })).status, 400)
    assert.equal((await post({ origin: new URL(env.publicWebOrigin).origin, 'content-type': 'application/json' })).status, 200)
    assert.equal((await app.request('/x', { headers: { cookie: c } })).status, 200)
    const { accessToken } = await issueCliCredential(mk('o2'))
    assert.equal((await app.request('/x', { method: 'POST', headers: bearer(accessToken) })).status, 200)
  })

  await it('authenticateUser records authVia and notifies the observer', async () => {
    const seen: string[] = []
    const restore = setAuthenticationObserver((u) => seen.push(u.sub))
    const { accessToken } = await issueCliCredential(mk('h'))
    const app = new Hono()
    app.get('/x', async (c) => {
      const u = await authenticateUser(c)
      return c.json({ sub: u?.sub ?? null, via: c.get('authVia' as never) ?? null })
    })
    assert.deepEqual(await (await app.request('/x', { headers: bearer(accessToken) })).json(), { sub: 'h', via: 'pat' })
    assert.deepEqual(seen, ['h'])
    restore()
    assert.equal((await (await app.request('/x')).json() as { sub: unknown }).sub, null)
  })

  await it('authenticateRequest returns user and via, or null; a scoped CLI credential only when allowed', async () => {
    const { accessToken } = await issueCliCredential(mk('r'))
    const { accessToken: scoped } = await issueCliCredential(mk('r2'), scope)
    const app = new Hono()
    app.get('/any', async (c) => c.json(await authenticateRequest(c, {})))
    app.get('/scoped', async (c) => c.json(await authenticateRequest(c, { allowScoped: true })))
    const sub = async (path: string, t?: string) =>
      ((await (await app.request(path, { headers: t ? bearer(t) : {} })).json()) as { user?: { sub: string }; via?: string } | null)
    assert.deepEqual(await sub('/any', accessToken).then((r) => [r?.user?.sub, r?.via]), ['r', 'pat'])
    assert.equal(await sub('/any', scoped), null)
    assert.deepEqual(await sub('/scoped', scoped).then((r) => [r?.user?.sub, r?.via]), ['r2', 'pat'])
    assert.equal(await sub('/any'), null)
  })

  await it('does not grant instance permissions from an IdP group on first contact', async () => {
    const { preparePrincipal } = await import('../../authz.js')
    const user = { ...mk('plain'), groups: ['devs'] }
    await preparePrincipal(user)
    assert.equal(await hasInstancePermission(user, 'create_namespace'), false)
  })

  await it('refuses an Auditor without MFA evidence on every credential, with a single reason', async () => {
    const { ensurePrincipal } = await import('./session.js')
    const { assignRole } = await import('../../rbacStore.js')
    const mfaToken = ['e30', Buffer.from(JSON.stringify({ acr: 'mfa', amr: ['pwd', 'otp'] })).toString('base64url'), 's'].join('.')
    const plainToken = ['e30', Buffer.from(JSON.stringify({ amr: ['pwd'] })).toString('base64url'), 's'].join('.')
    const role = async (sub: string, r: 'auditor' | 'user') => {
      await ensurePrincipal(mk(sub))
      const res = await assignRole({ actor: null, target: mk(sub), role: r, reason: 'test', bootstrap: true })
      assert.ok(res.ok)
    }
    const sessionCookie = async (sub: string, idToken?: string) => {
      const sessionId = await sealSession({ ...mk(sub), idToken, sessionStart: Math.floor(Date.now() / 1000) - 30 })
      return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
    }
    await role('aud-plain', 'auditor')
    await role('aud-mfa', 'auditor')
    await role('usr-plain', 'user')
    const app = appFor({})
    const reason = 'Auditor access requires MFA evidence'

    const noMfa = await app.request('/x', { headers: { cookie: await sessionCookie('aud-plain', plainToken) } })
    assert.equal(noMfa.status, 403)
    assert.deepEqual(await noMfa.json(), { error: reason })
    assert.equal((await app.request('/x', { headers: { cookie: await sessionCookie('aud-plain') } })).status, 403)
    const { accessToken } = await issueCliCredential(mk('aud-plain'))
    assert.equal((await app.request('/x', { headers: bearer(accessToken) })).status, 403)

    assert.equal((await app.request('/x', { headers: { cookie: await sessionCookie('aud-mfa', mfaToken) } })).status, 200)
    assert.equal((await app.request('/x', { headers: { cookie: await sessionCookie('usr-plain', plainToken) } })).status, 200)
  })
})
