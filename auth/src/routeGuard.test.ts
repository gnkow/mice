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
const { createPat } = await import('./tokens.js')
const { maybeBootstrapInstanceAdmin, isInstanceAdmin } = await import('./authzInstanceStore.js')
const { env } = await import('./env.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })
const cookie = async (sub: string) =>
  ({ cookie: `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })}` })
const json = { 'content-type': 'application/json' }

const app = new Hono()
app.post(
  '/admin',
  guarded(
    { gate: (u) => (isInstanceAdmin(u) ? null : 'Forbidden'), body: { required: ['sub', 'iss'] } },
    ({ user, body, via }) => Response.json({ by: user.sub, via, target: body }),
  ),
)
app.get('/me', guarded({ credential: 'session' }, ({ user }) => Response.json({ sub: user.sub })))
app.post('/optional', guarded({ body: 'optional' }, ({ body }) => Response.json({ body })))

describe('route guard', () => {
  it('answers 401 without credentials', async () => {
    assert.equal((await app.request('/me')).status, 401)
  })

  it('honours the credential policy', async () => {
    const { token } = createPat(mk('p'), 'p')
    assert.equal((await app.request('/me', { headers: { authorization: `Bearer ${token}` } })).status, 401)
    assert.equal((await app.request('/me', { headers: await cookie('p') })).status, 200)
  })

  it('answers 403 with the gate message, before reading the body', async () => {
    const r = await app.request('/admin', { method: 'POST', headers: { ...(await cookie('nobody')), ...json }, body: 'not json' })
    assert.equal(r.status, 403)
    assert.deepEqual(await r.json(), { error: 'Forbidden' })
  })

  it('answers 400 for an invalid or incomplete body', async () => {
    const h = { ...(await cookie('root')), ...json }
    const bad = await app.request('/admin', { method: 'POST', headers: h, body: 'nope' })
    assert.deepEqual([bad.status, await bad.json()], [400, { error: 'Invalid body' }])
    const missing = await app.request('/admin', { method: 'POST', headers: h, body: JSON.stringify({ sub: 'x' }) })
    assert.deepEqual([missing.status, await missing.json()], [400, { error: 'sub and iss required' }])
  })

  it('hands the handler a prepared Principal, via and the parsed body', async () => {
    const r = await app.request('/admin', { method: 'POST', headers: { ...(await cookie('root')), ...json }, body: JSON.stringify({ sub: 'x', iss: 'idp' }) })
    assert.deepEqual(await r.json(), { by: 'root', via: 'session', target: { sub: 'x', iss: 'idp' } })
  })

  it('treats an empty body as {} when optional', async () => {
    const r = await app.request('/optional', { method: 'POST', headers: await cookie('root') })
    assert.deepEqual(await r.json(), { body: {} })
  })
})
