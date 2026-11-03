import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../testSupport.js'

const ctx = isolatedAuth()
after(() => ctx.restore())

const { Hono } = await import('hono')
const { guarded } = await import('./routeGuard.js')
const { queryAudit } = await import('../../audit.js')

const json = { 'content-type': 'application/json' }
const ann = ctx.person('ann')

class Teapot extends Error {}

const app = new Hono()
app.post('/origin', guarded({ originCheck: true }, ({ c }) => c.json({ ok: true })))
app.post('/json', guarded({ body: 'json', invalidBody: 'Invalid JSON' }, ({ c, body }) => c.json({ body })))
app.post(
  '/shaped',
  guarded(
    { fail: (err, c) => (err instanceof Teapot ? c.json({ error: err.message }, 418) : null) },
    () => {
      throw new Teapot('short and stout')
    },
  ),
)
app.post('/unshaped', guarded({}, () => {
  throw new Error('boom')
}))
app.post('/audited', guarded({}, async ({ c, audit }) => {
  await audit({ action: 'test.audited', message: 'did it', namespace: 'ns1', detail: { n: 1 } })
  return c.json({ ok: true })
}))
app.get('/deny', guarded({}, ({ deny }) =>
  deny({ allow: false, reason: 'No thanks' }) ?? deny({ allow: false, reason: 'Teapot', status: 418 })!))
app.get('/allow', guarded({}, ({ deny, c }) => deny({ allow: true }) ?? c.json({ ok: true })))
app.post('/lazy', guarded({}, async ({ c, readBody }) => {
  const r = await readBody({ required: ['x'] }, 'Bad JSON')
  return r.ok ? c.json({ x: r.body.x }) : r.res
}))

describe('route entry', () => {
  it('answers the credential outcome status, not always 401', async () => {
    const headers = { ...(await ctx.sessionHeaders(ann)), ...json }
    delete headers.origin
    const r = await app.request('http://localhost/origin', { method: 'POST', headers })
    assert.deepEqual([r.status, await r.json()], [403, { error: 'Origin check failed' }])
  })

  it('shapes an unparseable JSON body with the route message', async () => {
    const headers = { ...(await ctx.sessionHeaders(ann)), ...json }
    const bad = await app.request('http://localhost/json', { method: 'POST', headers, body: 'nope' })
    assert.deepEqual([bad.status, await bad.json()], [400, { error: 'Invalid JSON' }])
    const ok = await app.request('http://localhost/json', { method: 'POST', headers, body: '[1]' })
    assert.deepEqual(await ok.json(), { body: [1] })
  })

  it('lets a route map its own errors and rethrows the rest', async () => {
    const headers = await ctx.sessionHeaders(ann)
    const r = await app.request('http://localhost/shaped', { method: 'POST', headers })
    assert.deepEqual([r.status, await r.json()], [418, { error: 'short and stout' }])
    assert.equal((await app.request('http://localhost/unshaped', { method: 'POST', headers })).status, 500)
  })

  it('audits as the caller with the request method and path', async () => {
    await app.request('http://localhost/audited', { method: 'POST', headers: await ctx.sessionHeaders(ann) })
    const e = (await queryAudit({ action: 'test.audited' })).events[0]!
    assert.deepEqual(
      [e.actor.sub, e.via, e.method, e.path, e.status, e.namespace, e.message, e.detail],
      ['ann', 'session', 'POST', '/audited', 200, 'ns1', 'did it', { n: 1 }],
    )
  })

  it('translates a decision to a denial response, defaulting to 403', async () => {
    const r = await app.request('http://localhost/deny', { headers: await ctx.sessionHeaders(ann) })
    assert.deepEqual([r.status, await r.json()], [403, { error: 'No thanks' }])
    const ok = await app.request('http://localhost/allow', { headers: await ctx.sessionHeaders(ann) })
    assert.equal(ok.status, 200)
  })

  it('reads the body on demand, after the handler ordered its own checks', async () => {
    const headers = { ...(await ctx.sessionHeaders(ann)), ...json }
    const bad = await app.request('http://localhost/lazy', { method: 'POST', headers, body: 'x' })
    assert.deepEqual([bad.status, await bad.json()], [400, { error: 'Bad JSON' }])
    const missing = await app.request('http://localhost/lazy', { method: 'POST', headers, body: '{}' })
    assert.deepEqual([missing.status, await missing.json()], [400, { error: 'x required' }])
    const ok = await app.request('http://localhost/lazy', { method: 'POST', headers, body: '{"x":5}' })
    assert.deepEqual(await ok.json(), { x: 5 })
  })
})
