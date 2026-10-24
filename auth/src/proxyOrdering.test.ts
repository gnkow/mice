import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { createMemoryJsonBackend, useJsonBackend } from './jsonStore.js'

const restoreBackend = useJsonBackend(createMemoryJsonBackend())
process.env.AUTH_DATA_DIR = '/mice-memory-proxy'
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://oxen.invalid'

const { Hono } = await import('hono')
const { proxyToOxen, setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')

type Call = { url: string; method: string; headers: Headers; body: string }
let calls: Call[] = []
const restoreUpstream = setUpstreamFetch(async (url, init) => {
  calls.push({
    url: String(url),
    method: String(init?.method),
    headers: new Headers(init?.headers),
    body: typeof init?.body === 'string' ? init.body : '',
  })
  return new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } })
})

const person = (sub: string) => ({ sub, iss: 'test', email: `${sub}@example.com`, name: sub })
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin', emailVerified: true }
preparePrincipal(admin)
const writer = person('po-writer')
const reader = person('po-reader')
createNamespaceAuthz(admin, 'po', 'none', true)
setRepoCollaborator('po', 'r', writer, 'write')
setRepoCollaborator('po', 'r', reader, 'read')
for (const u of [writer, reader]) preparePrincipal(u)

function appFor(user: typeof writer) {
  const app = new Hono()
  app.all('/api/*', (c) => proxyToOxen(c, { user, via: 'session' }))
  return app
}

describe('proxy orchestration order (fake upstream)', () => {
  beforeEach(() => {
    calls = []
  })
  after(() => {
    restoreUpstream()
    restoreBackend()
  })

  it('forwards an allowed read and strips credentials', async () => {
    const res = await appFor(reader).request('/api/repos/po/r/branches?x=1', {
      headers: { authorization: 'Bearer secret', cookie: 'a=b' },
    })
    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, 'http://oxen.invalid/api/repos/po/r/branches?x=1')
    assert.equal(calls[0]!.headers.get('authorization'), null)
    assert.equal(calls[0]!.headers.get('cookie'), null)
  })

  it('denies before contacting upstream (403)', async () => {
    const res = await appFor(reader).request('/api/repos/po/r/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"new_branch":"b"}',
    })
    assert.equal(res.status, 403)
    assert.equal(calls.length, 0)
  })

  it('unauthorized callers get 403, not a body rejection', async () => {
    const res = await appFor(reader).request('/api/repos/po/r/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    assert.equal(res.status, 403)
    assert.equal(calls.length, 0)
  })

  it('authorized callers with an unclassifiable body get 400 and no upstream call', async () => {
    const res = await appFor(writer).request('/api/repos/po/r/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    assert.equal(res.status, 400)
    assert.equal(calls.length, 0)
  })

  it('injects the Principal as author on an allowed write', async () => {
    const res = await appFor(writer).request('/api/repos/po/r/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"new_branch":"b","author_email":"evil@x.io"}',
    })
    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(JSON.parse(calls[0]!.body).author_email, 'po-writer@example.com')
  })

  it('rejects non-canonical paths before anything else', async () => {
    const res = await appFor(writer).request('/api/repos/po/r//branches')
    assert.equal(res.status, 400)
    assert.equal(calls.length, 0)
  })
})
