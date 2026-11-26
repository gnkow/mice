import '../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const {
  attachRepositoryId,
  filterNamespaceCatalog,
  finalizeProxiedRepoCreate,
  seedRepoCreate,
  stampRepositoryIdOnRepoDetail,
} = await import('../../src/packages/platform/index.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { getRepoCollaboratorRole, setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { createNamespaceAuthz, getNamespace } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')


const { assignRole } = await import('../../src/packages/authz/lib/rbacStore.js')
const { ensurePrincipal } = await import('../../src/packages/authentication/lib/session/session.js')
const person = (sub: string) => ({ sub, iss: 'test', email: `${sub}@example.com`, name: sub })
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin', emailVerified: true }
await assignRole({ actor: null, target: admin, role: 'manager', reason: 'test', bootstrap: true })

const catalog = () =>
  new Response(JSON.stringify({ namespaces: [{ namespace: 'pe-a' }, { name: 'pe-b' }] }), {
    headers: { 'content-type': 'application/json' },
  })
const names = (text: string | null) =>
  (JSON.parse(text ?? '{}').namespaces as Array<{ namespace?: string; name?: string }>).map(
    (n) => n.namespace ?? n.name,
  )

describe('filterNamespaceCatalog', async () => {
  const member = person('pe-member')
  await createNamespaceAuthz(admin, 'pe-a', 'none', true)
  await createNamespaceAuthz(admin, 'pe-b', 'none', true)
  await setRepoCollaborator('pe-a', 'r', member, 'read')
  await ensurePrincipal(member)
  await assignRole({ actor: null, target: member, role: 'user', reason: 'test', bootstrap: true })

  it('narrows the catalog to visible namespaces', async () => {
    const out = await filterNamespaceCatalog(member, 'GET', '/api/namespaces', catalog())
    assert.deepEqual(names(out), ['pe-a'])
  })
  it('leaves the full catalog to an instance admin', async () => {
    const out = await filterNamespaceCatalog(admin, 'GET', '/api/namespaces', catalog())
    assert.deepEqual(names(out), ['pe-a', 'pe-b'])
  })
  it('ignores other routes, methods and failed upstreams', async () => {
    assert.equal(await filterNamespaceCatalog(member, 'GET', '/api/namespaces/pe-a', catalog()), null)
    assert.equal(await filterNamespaceCatalog(member, 'POST', '/api/namespaces', catalog()), null)
    const failed = new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } })
    assert.equal(await filterNamespaceCatalog(member, 'GET', '/api/namespaces', failed), null)
  })
  it('rewrites physical UUID namespace keys to display names before filtering', async () => {
    const a = await getNamespace('pe-a')
    const b = await getNamespace('pe-b')
    assert.ok(a && b)
    const physicalCatalog = () =>
      new Response(JSON.stringify({ namespaces: [{ namespace: a.id }, { name: b.id }] }), {
        headers: { 'content-type': 'application/json' },
      })
    const out = await filterNamespaceCatalog(member, 'GET', '/api/namespaces', physicalCatalog())
    assert.deepEqual(names(out), ['pe-a'])
    const adminOut = await filterNamespaceCatalog(admin, 'GET', '/api/namespaces', physicalCatalog())
    assert.deepEqual(names(adminOut), ['pe-a', 'pe-b'])
  })
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('seedRepoCreate', () => {
  it('seeds the AuthZ repository without a creator collaborator seat', async () => {
    await seedRepoCreate(admin, 'pe-new', 'repo1')
    assert.ok(await getNamespace('pe-new'))
    assert.equal(await getRepoCollaboratorRole('pe-new', 'repo1', admin), null)
  })
  it('does not seed a namespace for a plain member', async () => {
    const u = person('pe-plain')
    await preparePrincipal(u)
    await seedRepoCreate(u, 'pe-unseeded', 'repo1')
    assert.equal(await getNamespace('pe-unseeded'), null)
  })
  it('returns a stable repository_id for the seeded repository', async () => {
    const first = await seedRepoCreate(admin, 'pe-stable', 'data')
    assert.ok(first)
    assert.match(first.repositoryId, UUID_RE)
    const second = await seedRepoCreate(admin, 'pe-stable', 'data')
    assert.equal(second?.repositoryId, first.repositoryId)
  })
})

describe('attachRepositoryId', () => {
  it('adds repository_id to a proxied create JSON body', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const out = attachRepositoryId(
      JSON.stringify({ status: 'success', repository: { namespace: 'n', name: 'r', repo_uuid: 'oxen' } }),
      id,
    )
    const body = JSON.parse(out)
    assert.equal(body.repository_id, id)
    assert.equal(body.repository.repository_id, id)
    assert.equal(body.repository.repo_uuid, 'oxen')
  })

  it('leaves non-JSON bodies untouched', () => {
    assert.equal(attachRepositoryId('not-json', 'id'), 'not-json')
  })
})

describe('finalizeProxiedRepoCreate', () => {
  it('seeds AuthZ and stamps repository_id onto the upstream create body', async () => {
    const upstream = JSON.stringify({
      status: 'success',
      repository: { namespace: 'pe-finalize', name: 'assay', repo_uuid: 'oxen-1' },
    })
    const out = await finalizeProxiedRepoCreate(admin, 'pe-finalize', 'assay', upstream)
    const body = JSON.parse(out)
    assert.match(body.repository_id, UUID_RE)
    assert.equal(body.repository.repository_id, body.repository_id)
    assert.equal(body.repository.repo_uuid, 'oxen-1')
    assert.equal(await getRepoCollaboratorRole('pe-finalize', 'assay', admin), null)
  })

  it('returns the upstream body unchanged when AuthZ cannot seed', async () => {
    const u = person('pe-finalize-plain')
    await preparePrincipal(u)
    const upstream = '{"status":"success"}'
    assert.equal(await finalizeProxiedRepoCreate(u, 'pe-no-ns', 'r', upstream), upstream)
  })
})

describe('stampRepositoryIdOnRepoDetail', () => {
  it('stamps the AuthZ id onto a successful GET repo detail body', async () => {
    await createNamespaceAuthz(admin, 'pe-detail', 'none', true)
    const record = await ensureRepository('pe-detail', 'study')
    assert.ok(record)
    const upstream = new Response(
      JSON.stringify({
        status: 'success',
        repository: { namespace: 'pe-detail', name: 'study', size: 7, data_types: [] },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const out = await stampRepositoryIdOnRepoDetail(
      'GET',
      '/api/repos/pe-detail/study',
      upstream,
    )
    assert.ok(out)
    const body = JSON.parse(out)
    assert.equal(body.repository_id, record.id)
    assert.equal(body.repository.repository_id, record.id)
  })

  it('mints an AuthZ id on first detail read when the row was missing', async () => {
    await createNamespaceAuthz(admin, 'pe-mint-get', 'none', true)
    const { readRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
    assert.equal(await readRepository('pe-mint-get', 'late'), null)
    const upstream = new Response(
      JSON.stringify({
        status: 'success',
        repository: { namespace: 'pe-mint-get', name: 'late' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const out = await stampRepositoryIdOnRepoDetail('GET', '/api/repos/pe-mint-get/late', upstream)
    assert.ok(out)
    const body = JSON.parse(out) as { repository_id?: string }
    const stored = await readRepository('pe-mint-get', 'late')
    assert.ok(stored)
    assert.equal(body.repository_id, stored.id)
  })

  it('ignores non-detail routes and failed upstreams', async () => {
    const ok = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    assert.equal(await stampRepositoryIdOnRepoDetail('GET', '/api/repos/pe-detail/study/branches', ok), null)
    assert.equal(await stampRepositoryIdOnRepoDetail('POST', '/api/repos/pe-detail/study', ok), null)
    const failed = new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    assert.equal(await stampRepositoryIdOnRepoDetail('GET', '/api/repos/pe-detail/study', failed), null)
  })
})
