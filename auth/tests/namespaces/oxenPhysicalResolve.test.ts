import '../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'
import { isPhysicalOxenKey } from '../../src/packages/namespaces/lib/oxenPhysicalKeys.js'
import { userKey } from '../../src/packages/authz/lib/authzTypes.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { createOwnedRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const {
  displayNamespaceName,
  displayRepoRef,
  preparePhysicalRepoCreate,
  resolveNamespaceId,
  resolvePhysicalRepo,
} = await import('../../src/packages/platform/index.js')

const alice = t.person('alice')

describe('oxenPhysicalResolve', () => {
  it('resolves display names to stable AuthZ ids and back', async () => {
    await createNamespaceAuthz(alice, 'phys-ns', 'none', true)
    const repo = await createOwnedRepository('phys-ns', 'assay', userKey(alice))
    assert.ok(repo)
    assert.ok(isPhysicalOxenKey(repo.namespaceId))
    assert.ok(isPhysicalOxenKey(repo.id))

    assert.equal(await resolveNamespaceId('phys-ns'), repo.namespaceId)
    assert.equal(await resolveNamespaceId(repo.namespaceId), repo.namespaceId)
    assert.deepEqual(await resolvePhysicalRepo('phys-ns', 'assay'), {
      namespaceId: repo.namespaceId,
      repositoryId: repo.id,
    })
    assert.equal(await displayNamespaceName(repo.namespaceId), 'phys-ns')
    assert.deepEqual(await displayRepoRef(repo.namespaceId, repo.id), {
      namespace: 'phys-ns',
      repo: 'assay',
    })
  })

  it('mints AuthZ repo ids for create against an existing namespace', async () => {
    await createNamespaceAuthz(alice, 'phys-create', 'none', true)
    const physical = await preparePhysicalRepoCreate(alice, 'phys-create', 'r1')
    assert.ok(physical)
    assert.ok(isPhysicalOxenKey(physical.namespaceId))
    assert.ok(isPhysicalOxenKey(physical.repositoryId))
    assert.equal(await displayNamespaceName(physical.namespaceId), 'phys-create')
  })

  it('refuses create seed when the caller cannot mint a namespace', async () => {
    const plain = t.person('phys-plain')
    await preparePrincipal(plain)
    assert.equal(await preparePhysicalRepoCreate(plain, 'phys-missing', 'r1'), null)
  })

  it('resolves display-ns + physical-repo-id without minting a UUID-named row', async () => {
    await createNamespaceAuthz(alice, 'phys-mix', 'none', true)
    const repo = await createOwnedRepository('phys-mix', 'sample', userKey(alice))
    assert.ok(repo)
    assert.deepEqual(await resolvePhysicalRepo('phys-mix', repo.id), {
      namespaceId: repo.namespaceId,
      repositoryId: repo.id,
    })
    // Must not create a second row whose display name is the physical id.
    assert.equal(await (await import('../../src/packages/authz/lib/repositoryStore.js')).readRepository('phys-mix', repo.id), null)
  })
})
