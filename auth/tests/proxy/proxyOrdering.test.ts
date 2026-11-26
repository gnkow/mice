import '../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://oxen.invalid'

const { Hono } = await import('hono')
const { proxyToOxen, setUpstreamFetch } = await import('../../src/packages/platform/index.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')

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

const { assignRole } = await import('../../src/packages/authz/lib/rbacStore.js')
const { ensurePrincipal } = await import('../../src/packages/authentication/lib/session/session.js')
const person = (sub: string) => ({ sub, iss: 'test', email: `${sub}@example.com`, name: sub })
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin', emailVerified: true }
await preparePrincipal(admin)
await assignRole({ actor: null, target: admin, role: 'manager', reason: 'test', bootstrap: true })
const writer = person('po-writer')
const reader = person('po-reader')
await createNamespaceAuthz(admin, 'po', 'none', true)
await setRepoCollaborator('po', 'r', writer, 'write')
await setRepoCollaborator('po', 'r', reader, 'read')
for (const u of [writer, reader]) {
  await ensurePrincipal(u)
  await assignRole({ actor: null, target: u, role: 'user', reason: 'test', bootstrap: true })
}
const { readRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const poRepo = await readRepository('po', 'r')
assert.ok(poRepo)
const poPhysicalPath = `/api/repos/${poRepo.namespaceId}/${poRepo.id}`

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
  })

  it('forwards an allowed read and strips credentials', async () => {
    const res = await appFor(reader).request('/api/repos/po/r/branches?x=1', {
      headers: { authorization: 'Bearer secret', cookie: 'a=b' },
    })
    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.url, `http://oxen.invalid${poPhysicalPath}/branches?x=1`)
    assert.equal(calls[0]!.headers.get('authorization'), null)
    assert.equal(calls[0]!.headers.get('cookie'), null)
  })

  it('rewrites repo list paths to the physical namespace id', async () => {
    // List authz requires namespace membership (repo collaborator alone is not enough).
    const res = await appFor(admin).request('/api/repos/po', {
      headers: { authorization: 'Bearer secret' },
    })
    assert.equal(res.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(
      calls[0]!.url,
      `http://oxen.invalid/api/repos/${poRepo.namespaceId}`,
    )
  })

  it('rewrites physical UUID keys in list JSON back to display names', async () => {
    const restoreList = setUpstreamFetch(async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          repositories: [
            { namespace: poRepo.namespaceId, name: poRepo.id, min_version: '0.36.0' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    try {
      const res = await appFor(admin).request('/api/repos/po')
      assert.equal(res.status, 200)
      const body = (await res.json()) as {
        repositories: Array<{ namespace: string; name: string; min_version?: string }>
      }
      assert.deepEqual(body.repositories, [
        { namespace: 'po', name: 'r', min_version: '0.36.0' },
      ])
    } finally {
      restoreList()
    }
  })

  it('renames via AuthZ without contacting oxen', async () => {
    const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
    const scratch = await ensureRepository('po', 'rename-me')
    assert.ok(scratch)
    const { regulatedMutationHeaders } = await import('../../src/packages/shared/lib/testSupport.js')
    const path = '/api/repos/po/rename-me/rename'
    const body = JSON.stringify({ repo_name: 'renamed-ok' })
    const signed = await regulatedMutationHeaders(admin, {
      method: 'PATCH',
      path,
      body: { repo_name: 'renamed-ok' },
      reason: 'Routine test change',
    })
    const res = await appFor(admin).request(path, {
      method: 'PATCH',
      headers: {
        ...signed,
        'content-type': 'application/json',
        'x-mice-change-control-id': 'CC-2026-114',
      },
      body,
    })
    assert.equal(res.status, 200)
    assert.equal(calls.length, 0)
    const json = (await res.json()) as { repository?: { name?: string } }
    assert.equal(json.repository?.name, 'renamed-ok')
    const renamed = await readRepository('po', 'renamed-ok')
    assert.ok(renamed)
    assert.equal(renamed.id, scratch.id)
  })

  it('denies before contacting upstream (403)', async () => {
    const res = await appFor(reader).request('/api/repos/po/r/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change', 'x-mice-change-control-id': 'CC-2026-114' },
      body: '{"new_branch":"b"}',
    })
    assert.equal(res.status, 403)
    assert.equal(calls.length, 0)
  })

  it('unauthorized callers get 403, not a body rejection', async () => {
    const res = await appFor(reader).request('/api/repos/po/r/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change', 'x-mice-change-control-id': 'CC-2026-114' },
      body: 'not json',
    })
    assert.equal(res.status, 403)
    assert.equal(calls.length, 0)
  })

  it('authorized callers with an unclassifiable body get 400 and no upstream call', async () => {
    const res = await appFor(writer).request('/api/repos/po/r/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change', 'x-mice-change-control-id': 'CC-2026-114' },
      body: 'not json',
    })
    assert.equal(res.status, 400)
    assert.equal(calls.length, 0)
  })

  it('injects the Principal as author on an allowed write', async () => {
    const res = await appFor(writer).request('/api/repos/po/r/branches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change', 'x-mice-change-control-id': 'CC-2026-114' },
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
