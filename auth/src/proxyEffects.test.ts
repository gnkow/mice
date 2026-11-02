import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { filterNamespaceCatalog, seedRepoCreate } = await import('./proxyEffects.js')
const { preparePrincipal } = await import('./authz.js')
const { getRepoCollaboratorRole, setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz, getNamespace } = await import('./authzNamespaceStore.js')


const person = (sub: string) => ({ sub, iss: 'test', email: `${sub}@example.com`, name: sub })
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin', emailVerified: true }
await preparePrincipal(admin)

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
  await preparePrincipal(member)

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
})

describe('seedRepoCreate', () => {
  it('makes the creator repo admin and seeds the namespace for an instance admin', async () => {
    await seedRepoCreate(admin, 'pe-new', 'repo1')
    assert.ok(await getNamespace('pe-new'))
    assert.equal(await getRepoCollaboratorRole('pe-new', 'repo1', admin), 'admin')
  })
  it('does not seed a namespace for a plain member', async () => {
    const u = person('pe-plain')
    await preparePrincipal(u)
    await seedRepoCreate(u, 'pe-unseeded', 'repo1')
    assert.equal(await getNamespace('pe-unseeded'), null)
  })
})
