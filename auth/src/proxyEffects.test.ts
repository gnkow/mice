import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createMemoryJsonBackend, useJsonBackend } from './jsonStore.js'

const restoreBackend = useJsonBackend(createMemoryJsonBackend())
process.env.AUTH_DATA_DIR = '/mice-memory-data'
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { filterNamespaceCatalog, seedRepoCreate } = await import('./proxyEffects.js')
const { preparePrincipal } = await import('./authz.js')
const { getRepoCollaboratorRole, setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz, getNamespace } = await import('./authzNamespaceStore.js')

after(() => restoreBackend())

const person = (sub: string) => ({ sub, iss: 'test', email: `${sub}@example.com`, name: sub })
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin', emailVerified: true }
preparePrincipal(admin)

const catalog = () =>
  new Response(JSON.stringify({ namespaces: [{ namespace: 'pe-a' }, { name: 'pe-b' }] }), {
    headers: { 'content-type': 'application/json' },
  })
const names = (text: string | null) =>
  (JSON.parse(text ?? '{}').namespaces as Array<{ namespace?: string; name?: string }>).map(
    (n) => n.namespace ?? n.name,
  )

describe('filterNamespaceCatalog', () => {
  const member = person('pe-member')
  createNamespaceAuthz(admin, 'pe-a', 'none', true)
  createNamespaceAuthz(admin, 'pe-b', 'none', true)
  setRepoCollaborator('pe-a', 'r', member, 'read')
  preparePrincipal(member)

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
  it('makes the creator repo admin and seeds the namespace for an instance admin', () => {
    seedRepoCreate(admin, 'pe-new', 'repo1')
    assert.ok(getNamespace('pe-new'))
    assert.equal(getRepoCollaboratorRole('pe-new', 'repo1', admin), 'admin')
  })
  it('does not seed a namespace for a plain member', () => {
    const u = person('pe-plain')
    preparePrincipal(u)
    seedRepoCreate(u, 'pe-unseeded', 'repo1')
    assert.equal(getNamespace('pe-unseeded'), null)
  })
})
