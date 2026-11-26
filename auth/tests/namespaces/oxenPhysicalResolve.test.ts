import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'
import { isPhysicalOxenKey } from '../../src/packages/namespaces/lib/oxenPhysicalKeys.js'
import { userKey } from '../../src/packages/authz/lib/authzTypes.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { createOwnedRepository, renameRepository } = await import(
  '../../src/packages/authz/lib/repositoryStore.js'
)
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const {
  displayNamespaceName,
  displayRepoRef,
  mapDisplayRequestToPhysical,
  mapPhysicalResponseToDisplay,
  preparePhysicalRepoCreate,
  resolveNamespaceId,
  resolvePhysicalRepo,
} = await import('../../src/packages/namespaces/index.js')

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
    assert.equal(
      await (
        await import('../../src/packages/authz/lib/repositoryStore.js')
      ).readRepository('phys-mix', repo.id),
      null,
    )
  })

  it('mapDisplayRequestToPhysical rewrites repo paths behind one resolve+rewrite call', async () => {
    await createNamespaceAuthz(alice, 'map-ns', 'none', true)
    const repo = await createOwnedRepository('map-ns', 'assay', userKey(alice))
    assert.ok(repo)

    const mapped = await mapDisplayRequestToPhysical({
      pathname: '/api/repos/map-ns/assay/branches',
      body: undefined,
      signatureBody: undefined,
      user: alice,
      ns: 'map-ns',
      repo: 'assay',
      kind: 'repo',
      action: 'repo.read',
    })
    assert.equal(mapped.ok, true)
    if (!mapped.ok) return
    assert.equal(mapped.path, `/api/repos/${repo.namespaceId}/${repo.id}/branches`)
    assert.deepEqual(mapped.physicalRepo, {
      namespaceId: repo.namespaceId,
      repositoryId: repo.id,
    })
    assert.equal(mapped.createdPhysical, null)
  })

  it('mapDisplayRequestToPhysical prepares create bodies with physical keys', async () => {
    await createNamespaceAuthz(alice, 'map-create', 'none', true)
    const mapped = await mapDisplayRequestToPhysical({
      pathname: '/api/repos',
      body: JSON.stringify({
        namespace: 'map-create',
        name: 'study',
        initial_commit_message: 'Boot',
        extra: 1,
      }),
      signatureBody: { initial_commit_message: 'Boot' },
      user: alice,
      ns: 'map-create',
      repo: 'study',
      kind: 'repo.create',
      action: 'repo.create',
    })
    assert.equal(mapped.ok, true)
    if (!mapped.ok) return
    assert.ok(mapped.createdPhysical)
    assert.ok(isPhysicalOxenKey(mapped.createdPhysical.namespaceId))
    assert.ok(isPhysicalOxenKey(mapped.createdPhysical.repositoryId))
    assert.equal(mapped.initialCommitMessage, 'Boot')
    assert.deepEqual(JSON.parse(mapped.body ?? '{}'), {
      namespace: mapped.createdPhysical.namespaceId,
      name: mapped.createdPhysical.repositoryId,
      extra: 1,
    })
  })

  it('mapPhysicalResponseToDisplay resolves UUID catalogs without proxy glue', async () => {
    await createNamespaceAuthz(alice, 'map-json', 'none', true)
    const repo = await createOwnedRepository('map-json', 'assay', userKey(alice))
    assert.ok(repo)

    const out = await mapPhysicalResponseToDisplay(
      JSON.stringify({
        repositories: [{ namespace: repo.namespaceId, name: repo.id, size: 1 }],
      }),
      { displayNs: 'map-json', displayRepo: 'assay' },
    )
    assert.deepEqual(JSON.parse(out), {
      repositories: [{ namespace: 'map-json', name: 'assay', size: 1 }],
    })
  })

  it('create → rename → list mapping keeps physical ids (no oxen move)', async () => {
    await createNamespaceAuthz(alice, 'map-rename', 'none', true)
    const created = await mapDisplayRequestToPhysical({
      pathname: '/api/repos',
      body: JSON.stringify({ namespace: 'map-rename', name: 'before' }),
      signatureBody: undefined,
      user: alice,
      ns: 'map-rename',
      repo: 'before',
      kind: 'repo.create',
      action: 'repo.create',
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.ok(created.createdPhysical)
    const physical = created.createdPhysical

    const renamed = await renameRepository('map-rename', 'before', 'after')
    assert.equal(renamed.ok, true)

    const afterResolve = await resolvePhysicalRepo('map-rename', 'after')
    assert.deepEqual(afterResolve, physical)

    const list = await mapDisplayRequestToPhysical({
      pathname: '/api/repos/map-rename',
      body: undefined,
      signatureBody: undefined,
      user: alice,
      ns: 'map-rename',
      repo: undefined,
      kind: 'repo.list',
      action: 'repo.list',
    })
    assert.equal(list.ok, true)
    if (!list.ok) return
    assert.equal(list.path, `/api/repos/${physical.namespaceId}`)

    const listed = await mapPhysicalResponseToDisplay(
      JSON.stringify({
        repositories: [{ namespace: physical.namespaceId, name: physical.repositoryId }],
      }),
    )
    assert.deepEqual(JSON.parse(listed), {
      repositories: [{ namespace: 'map-rename', name: 'after' }],
    })
  })
})
