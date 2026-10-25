import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { createNamespaceAuthz, deleteNamespaceAuthz, getNamespace } = await import('./authzNamespaceStore.js')
const { listNamespaceMembers, removeNamespaceMember, setNamespaceMember, setNamespaceGroupMember, removeNamespaceGroupMember } =
  await import('./authzMembershipStore.js')
const { listRepoCollaborators, setRepoCollaborator, setRepoGroupCollaborator } = await import('./authzCollaboratorStore.js')
const { createCustomNamespaceRole, listCustomNamespaceRoles } = await import('./customRoles.js')

const alice = t.person('alice')
const bob = t.person('bob')

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
    await createNamespaceAuthz(bob, 'team-b', 'none')
    assert.deepEqual(await listNamespaceMembers('team-b'), [{ kind: 'user', sub: 'bob', iss: 'test', role: 'owner' }])
    assert.deepEqual(await listRepoCollaborators('team-b', 'r1'), [])
  })
})
