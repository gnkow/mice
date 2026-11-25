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
app.post(
  '/sign-like',
  guarded({ body: { required: ['content', 'meaning', 'expectedHash'] } }, ({ body }) =>
    Response.json({ content: body.content, meaning: body.meaning }),
  ),
)

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
    assert.deepEqual([missing.status, await missing.json()], [400, { error: 'iss required' }])
    const none = await app.request('/admin', { method: 'POST', headers: h, body: JSON.stringify({}) })
    assert.deepEqual([none.status, await none.json()], [400, { error: 'sub and iss required' }])
  })

  await it('hands the handler a prepared Principal, via and the parsed body', async () => {
    const r = await app.request('/admin', { method: 'POST', headers: { ...(await cookie('root')), ...json }, body: JSON.stringify({ sub: 'x', iss: 'idp' }) })
    assert.deepEqual(await r.json(), { by: 'root', via: 'session', target: { sub: 'x', iss: 'idp' } })
  })

  await it('treats an empty body as {} when optional', async () => {
    const r = await app.request('/optional', { method: 'POST', headers: await cookie('root') })
    assert.deepEqual(await r.json(), { body: {} })
  })

  await it('accepts required fields that are present as empty string (empty merge manifest)', async () => {
    const h = { ...(await cookie('root')), ...json }
    const r = await app.request('/sign-like', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ content: '', meaning: 'Approved', expectedHash: 'abc' }),
    })
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { content: '', meaning: 'Approved' })
    const missing = await app.request('/sign-like', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ meaning: 'Approved', expectedHash: 'abc' }),
    })
    assert.deepEqual([missing.status, await missing.json()], [400, { error: 'content required' }])
  })

  await it('fails loudly at registration when a mutating route names no operation', () => {
    const noop = () => Response.json({})
    // Cast: the policy type already forbids these; JS callers and casts must fail at runtime too.
    const bad = (action: unknown) => () =>
      guarded({ mutates: true, action } as unknown as Parameters<typeof guarded>[0], noop)
    assert.throws(bad(undefined), /must name its operation/)
    assert.throws(bad(''), /must name its operation/)
    assert.throws(bad('   '), /must name its operation/)
    assert.throws(bad('bff.mutation'), /never be written as an Intent action/)
    assert.doesNotThrow(bad('merge_request.open'))
  })

  await it('refuses before any Intent when an action resolver names no operation', async () => {
    const decide = new Hono()
    decide.post(
      '/decide',
      guarded(
        {
          mutates: true,
          action: ({ c, body }) =>
            body.action === 'approve' ? 'access-request.approve' : c.json({ error: 'action required' }, 400),
          body: 'json',
        },
        () => Response.json({ ok: true }),
      ),
    )
    const r = await decide.request('/decide', {
      method: 'POST',
      headers: { ...(await cookie('root')), ...json },
      body: JSON.stringify({ action: 'nonsense' }),
    })
    assert.deepEqual([r.status, await r.json()], [400, { error: 'action required' }])
  })

  await it('fails loudly when an action resolver answers bff.mutation', async () => {
    const bad = new Hono()
    bad.post('/bad', guarded({ mutates: true, action: () => 'bff.mutation', body: 'optional' }, () => Response.json({})))
    bad.onError((err, c) => c.json({ error: err.name }, 500))
    const r = await bad.request('/bad', { method: 'POST', headers: await cookie('root') })
    assert.deepEqual([r.status, await r.json()], [500, { error: 'IntentActionError' }])
  })
})
