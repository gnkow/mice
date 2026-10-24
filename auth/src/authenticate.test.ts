import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-authn-'))
process.env.SESSION_SECRET = 'test-session-secret-for-authn'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'
process.env.AUTHZ_GROUP_BOOTSTRAP = JSON.stringify({
  'idp|viacookie': { instancePermissions: ['create_namespace'] },
  'idp|viapat': { instancePermissions: ['create_namespace'] },
})

const { Hono } = await import('hono')
const { authenticate, authenticateUser, authenticateRequest, onAuthenticated } = await import('./requireAuth.js')
type Policy = NonNullable<Parameters<typeof authenticate>[1]>
const { sealSession } = await import('./session.js')
const { createPat } = await import('./tokens.js')
const { createServicePrincipal, serviceUser } = await import('./servicePrincipals.js')
const { env } = await import('./env.js')
const { hasInstancePermission } = await import('./authzInstanceStore.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
const appFor = (policy: Policy) => {
  const app = new Hono()
  app.all('/x', async (c) => {
    const r = await authenticate(c, policy)
    return r.ok ? c.json({ sub: r.user.sub, via: r.via }) : c.json({ error: r.error }, r.status)
  })
  return app
}
const cookie = async (sub: string) =>
  `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })}`
const scope = [{ namespace: 'ns', maxRole: 'read' as const }]
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

describe('authenticate', () => {
  it('accepts a cookie Session, then an unscoped PAT, by default', async () => {
    const app = appFor({})
    const { token } = createPat(mk('a'), 'a')
    assert.deepEqual(await (await app.request('/x', { headers: { cookie: await cookie('b') } })).json(), { sub: 'b', via: 'session' })
    assert.deepEqual(await (await app.request('/x', { headers: bearer(token) })).json(), { sub: 'a', via: 'pat' })
    assert.equal((await app.request('/x')).status, 401)
  })

  it('rejects scoped PATs unless allowScoped', async () => {
    const { token } = createPat(mk('s'), 's', scope)
    assert.equal((await appFor({}).request('/x', { headers: bearer(token) })).status, 401)
    assert.equal((await appFor({ allowScoped: true }).request('/x', { headers: bearer(token) })).status, 200)
  })

  it('credential: session refuses PATs', async () => {
    const { token } = createPat(mk('p'), 'p')
    assert.equal((await appFor({ credential: 'session' }).request('/x', { headers: bearer(token) })).status, 401)
    assert.equal((await appFor({ credential: 'session' }).request('/x', { headers: { cookie: await cookie('p') } })).status, 200)
  })

  it('refuses a Principal lacking the required capability', async () => {
    const r = createServicePrincipal({ name: 'ci', owner: mk('owner') })
    assert.ok(r.ok)
    const { token } = createPat(serviceUser(r.principal), 'ci')
    const refused = await appFor({ requires: { capability: 'hasFavorites', message: 'no favorites' } }).request('/x', { headers: bearer(token) })
    assert.equal(refused.status, 403)
    assert.equal((await appFor({}).request('/x', { headers: bearer(token) })).status, 200)
  })

  it('checks Origin and content type for cookie Sessions on unsafe methods only', async () => {
    const app = appFor({ originCheck: true, jsonOnly: true })
    const c = await cookie('o')
    const post = (headers: Record<string, string>) => app.request('/x', { method: 'POST', headers: { cookie: c, ...headers } })
    assert.equal((await post({})).status, 403)
    assert.equal((await post({ origin: new URL(env.publicWebOrigin).origin })).status, 400)
    assert.equal((await post({ origin: new URL(env.publicWebOrigin).origin, 'content-type': 'application/json' })).status, 200)
    assert.equal((await app.request('/x', { headers: { cookie: c } })).status, 200)
    const { token } = createPat(mk('o2'), 'o')
    assert.equal((await app.request('/x', { method: 'POST', headers: bearer(token) })).status, 200)
  })

  it('authenticateUser records authVia and runs onAuthenticated hooks', async () => {
    const seen: string[] = []
    onAuthenticated((u) => seen.push(u.sub))
    const { token } = createPat(mk('h'), 'h')
    const app = new Hono()
    app.get('/x', async (c) => {
      const u = await authenticateUser(c)
      return c.json({ sub: u?.sub ?? null, via: c.get('authVia' as never) ?? null })
    })
    assert.deepEqual(await (await app.request('/x', { headers: bearer(token) })).json(), { sub: 'h', via: 'pat' })
    assert.deepEqual(seen, ['h'])
    assert.equal((await (await app.request('/x')).json() as { sub: unknown }).sub, null)
  })

  it('authenticateRequest returns user and via, or null; scoped PATs only when allowed', async () => {
    const { token } = createPat(mk('r'), 'r')
    const { token: scoped } = createPat(mk('r2'), 'r2', scope)
    const app = new Hono()
    app.get('/any', async (c) => c.json(await authenticateRequest(c, {})))
    app.get('/scoped', async (c) => c.json(await authenticateRequest(c, { allowScoped: true })))
    const sub = async (path: string, t?: string) =>
      ((await (await app.request(path, { headers: t ? bearer(t) : {} })).json()) as { user?: { sub: string }; via?: string } | null)
    assert.deepEqual(await sub('/any', token).then((r) => [r?.user?.sub, r?.via]), ['r', 'pat'])
    assert.equal(await sub('/any', scoped), null)
    assert.deepEqual(await sub('/scoped', scoped).then((r) => [r?.user?.sub, r?.via]), ['r2', 'pat'])
    assert.equal(await sub('/any'), null)
  })

  it('hands handlers a prepared Principal: bootstrap grants apply on first contact', async () => {
    const app = new Hono()
    app.get('/perm', async (c) =>
      c.json({ can: hasInstancePermission((await authenticateRequest(c, {}))!.user, 'create_namespace') }),
    )
    const can = async (headers: Record<string, string>) =>
      ((await (await app.request('/perm', { headers })).json()) as { can: boolean }).can

    assert.equal(hasInstancePermission(mk('viacookie'), 'create_namespace'), false)
    assert.equal(await can({ cookie: await cookie('viacookie') }), true)
    assert.equal(hasInstancePermission(mk('viapat'), 'create_namespace'), false)
    assert.equal(await can(bearer(createPat(mk('viapat'), 'p').token)), true)
  })
})
