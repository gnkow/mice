import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { createNamespaceAuthz, deleteNamespaceAuthz, getNamespace, renameNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { listNamespaceMembers, removeNamespaceMember, setNamespaceMember, setNamespaceGroupMember, removeNamespaceGroupMember } =
  await import('./authzMembershipStore.js')
const { listRepoCollaborators, setRepoCollaborator, setRepoGroupCollaborator } = await import('./authzCollaboratorStore.js')
const { createCustomNamespaceRole, listCustomNamespaceRoles } = await import('./customRoles.js')

const alice = t.person('alice')
const bob = t.person('bob')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('stable namespace ids', () => {
  it('create mints a stable UUID that rename preserves', async () => {
    assert.deepEqual(await createNamespaceAuthz(alice, 'stable-ns', 'read'), { ok: true })
    const created = await getNamespace('stable-ns')
    assert.ok(created)
    assert.match(created.id, UUID_RE)
    const id = created.id

    assert.deepEqual(await renameNamespaceAuthz('stable-ns', 'stable-ns-renamed'), { ok: true })
    assert.equal(await getNamespace('stable-ns'), null)
    const renamed = await getNamespace('stable-ns-renamed')
    assert.ok(renamed)
    assert.equal(renamed.id, id)
    assert.equal(renamed.createdBy, 'test\u001falice')
  })
})

const { ensureRepository, readRepository, renameRepository } = await import('./repositoryStore.js')
const { hasRepoPermission } = await import('./authz.js')

describe('stable repository ids', () => {
  it('ensure mints a stable UUID that rename preserves', async () => {
    await createNamespaceAuthz(alice, 'repo-ns', 'none')
    const created = await ensureRepository('repo-ns', 'study')
    assert.ok(created)
    assert.match(created.id, UUID_RE)
    const again = await ensureRepository('repo-ns', 'study')
    assert.equal(again?.id, created.id)

    assert.deepEqual(await renameRepository('repo-ns', 'study', 'study-v2'), { ok: true })
    assert.equal(await readRepository('repo-ns', 'study'), null)
    const renamed = await readRepository('repo-ns', 'study-v2')
    assert.ok(renamed)
    assert.equal(renamed.id, created.id)
  })
})

describe('grants survive rename', () => {
  it('collaborator access remains after repository and namespace rename', async () => {
    await createNamespaceAuthz(alice, 'grant-ns', 'none')
    await setRepoCollaborator('grant-ns', 'data', bob, 'write')
    const before = await hasRepoPermission(bob, 'grant-ns', 'data', 'write')
    assert.equal(before.ok, true)

    assert.deepEqual(await renameRepository('grant-ns', 'data', 'data2'), { ok: true })
    assert.equal((await hasRepoPermission(bob, 'grant-ns', 'data2', 'write')).ok, true)

    assert.deepEqual(await renameNamespaceAuthz('grant-ns', 'grant-ns2'), { ok: true })
    assert.equal((await hasRepoPermission(bob, 'grant-ns2', 'data2', 'write')).ok, true)
  })
})

describe('entity name tombstones', () => {
  it('blocks reuse of a deleted repository name', async () => {
    await createNamespaceAuthz(alice, 'tomb-ns', 'none')
    assert.ok(await ensureRepository('tomb-ns', 'gone'))
    const { deleteRepositoryRecord } = await import('./repositoryStore.js')
    assert.deepEqual(await deleteRepositoryRecord('tomb-ns', 'gone'), { ok: true })
    assert.equal(await ensureRepository('tomb-ns', 'gone'), null)
    assert.ok(await ensureRepository('tomb-ns', 'fresh'))
  })
})

describe('audit entity ids', () => {
  it('fills namespace_id and repository_id from names', async () => {
    await createNamespaceAuthz(alice, 'audit-ns', 'none')
    const repo = await ensureRepository('audit-ns', 'audit-repo')
    assert.ok(repo)
    const { appendAudit } = await import('./audit.js')
    const event = await appendAudit({
      actor: { sub: 'alice', iss: 'test', email: 'a@e', name: 'alice' },
      via: 'session',
      method: 'POST',
      path: '/x',
      status: 200,
      action: 'file.write',
      namespace: 'audit-ns',
      repo: 'audit-repo',
    })
    assert.ok(event)
    assert.equal(event.namespace_id, repo.namespaceId)
    assert.equal(event.repository_id, repo.id)
    assert.equal(event.namespace, 'audit-ns')
    assert.equal(event.repo, 'audit-repo')
  })
})

describe('authz list exposes namespace id', () => {
  it('includes id on listed namespaces', async () => {
    await createNamespaceAuthz(alice, 'list-ns', 'none')
    const { listNamespacesForUser } = await import('./authzNamespaceStore.js')
    const listed = await listNamespacesForUser(alice)
    const row = listed.find((n) => n.name === 'list-ns')
    assert.ok(row)
    assert.match(row.id, UUID_RE)
  })
})

describe('authz repository', () => {
  it('create leaves the creator as the only owner', async () => {
    assert.deepEqual(await createNamespaceAuthz(alice, 'team-a', 'read'), { ok: true })
    assert.deepEqual(await listNamespaceMembers('team-a'), [{ kind: 'user', sub: 'alice', iss: 'test', role: 'owner' }])
    assert.equal((await getNamespace('team-a'))?.createdBy, 'test\u001falice')
  })

  it('create rejects duplicates and invalid names without touching members', async () => {
    assert.deepEqual(await createNamespaceAuthz(bob, 'team-a', 'none'), { ok: false, error: 'Namespace already exists' })
    assert.deepEqual(await createNamespaceAuthz(bob, 'bad name', 'none'), { ok: false, error: 'Invalid namespace name' })
    assert.equal((await listNamespaceMembers('team-a')).length, 1)
  })

  it('last owner cannot be demoted or removed on any path', async () => {
    assert.deepEqual(await setNamespaceMember('team-a', alice, 'member'), { ok: false, error: 'Cannot demote the last namespace Owner' })
    assert.deepEqual(await removeNamespaceMember('team-a', alice), { ok: false, error: 'Cannot remove the last namespace Owner' })
    assert.equal((await listNamespaceMembers('team-a'))[0]?.role, 'owner')

    assert.deepEqual(await setNamespaceGroupMember('team-a', 'Eng', 'owner'), { ok: true })
    assert.deepEqual(await setNamespaceMember('team-a', alice, 'member'), { ok: true })
    assert.deepEqual(await setNamespaceGroupMember('team-a', 'Eng', 'member'), {
      ok: false,
      error: 'Cannot demote the last namespace Owner',
    })
    assert.deepEqual(await removeNamespaceGroupMember('team-a', 'Eng'), {
      ok: false,
      error: 'Cannot remove the last namespace Owner',
    })
    assert.deepEqual(await setNamespaceMember('team-a', alice, 'owner'), { ok: true })
    assert.deepEqual(await removeNamespaceGroupMember('team-a', 'Eng'), { ok: true })
  })

  it('delete cascades members, collaborators and custom roles, leaving no orphans', async () => {
    await createNamespaceAuthz(alice, 'team-b', 'none')
    await createNamespaceAuthz(alice, 'team-bb', 'none')
    await setNamespaceMember('team-b', bob, 'member')
    await setRepoCollaborator('team-b', 'r1', bob, 'read')
    await setRepoGroupCollaborator('team-b', 'r2', 'eng', 'write')
    await setRepoCollaborator('team-bb', 'r1', bob, 'read')
    await createCustomNamespaceRole('team-b', { name: 'Auditor', permissions: [] })

    assert.deepEqual(await deleteNamespaceAuthz('team-b'), { ok: true })

    assert.equal(await getNamespace('team-b'), null)
    assert.deepEqual(await listNamespaceMembers('team-b'), [])
    assert.deepEqual(await listRepoCollaborators('team-b', 'r1'), [])
    assert.deepEqual(await listRepoCollaborators('team-b', 'r2'), [])
    assert.deepEqual(await listCustomNamespaceRoles('team-b'), [])
    assert.equal((await listNamespaceMembers('team-bb')).length, 1)
    assert.equal((await listRepoCollaborators('team-bb', 'r1')).length, 1)

    assert.deepEqual(await deleteNamespaceAuthz('team-b'), { ok: false, error: 'Namespace not found' })
    assert.deepEqual(await createNamespaceAuthz(bob, 'team-b', 'none'), {
      ok: false,
      error: 'Namespace name is reserved after deletion',
    })
    assert.deepEqual(await createNamespaceAuthz(bob, 'team-b-fresh', 'none'), { ok: true })
    assert.deepEqual(await listNamespaceMembers('team-b-fresh'), [{ kind: 'user', sub: 'bob', iss: 'test', role: 'owner' }])
  })
})
