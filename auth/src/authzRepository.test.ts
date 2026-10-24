import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const repo = await import('./authzRepository.js')
const { createNamespaceAuthz, deleteNamespaceAuthz, getNamespace } = await import('./authzNamespaceStore.js')
const { listNamespaceMembers, removeNamespaceMember, setNamespaceMember, setNamespaceGroupMember, removeNamespaceGroupMember } =
  await import('./authzMembershipStore.js')
const { listRepoCollaborators, setRepoCollaborator, setRepoGroupCollaborator } = await import('./authzCollaboratorStore.js')
const { createCustomNamespaceRole, listCustomNamespaceRoles } = await import('./customRoles.js')

const alice = t.person('alice')
const bob = t.person('bob')

describe('authz repository', () => {
  it('does not export raw document readers or writers', () => {
    const exported = Object.keys(repo)
    assert.deepEqual(
      exported.filter((k) => /^(read|write)(Instance|Namespaces|Members|Collaborators)$/.test(k)),
      [],
    )
  })

  it('create leaves the creator as the only owner', () => {
    assert.deepEqual(createNamespaceAuthz(alice, 'team-a', 'read'), { ok: true })
    assert.deepEqual(listNamespaceMembers('team-a'), [{ kind: 'user', sub: 'alice', iss: 'test', role: 'owner' }])
    assert.equal(getNamespace('team-a')?.createdBy, 'test\u0000alice')
  })

  it('create rejects duplicates and invalid names without touching members', () => {
    assert.deepEqual(createNamespaceAuthz(bob, 'team-a', 'none'), { ok: false, error: 'Namespace already exists' })
    assert.deepEqual(createNamespaceAuthz(bob, 'bad name', 'none'), { ok: false, error: 'Invalid namespace name' })
    assert.equal(listNamespaceMembers('team-a').length, 1)
  })

  it('last owner cannot be demoted or removed on any path', () => {
    assert.deepEqual(setNamespaceMember('team-a', alice, 'member'), { ok: false, error: 'Cannot demote the last namespace Owner' })
    assert.deepEqual(removeNamespaceMember('team-a', alice), { ok: false, error: 'Cannot remove the last namespace Owner' })
    assert.equal(listNamespaceMembers('team-a')[0]?.role, 'owner')

    assert.deepEqual(setNamespaceGroupMember('team-a', 'Eng', 'owner'), { ok: true })
    assert.deepEqual(setNamespaceMember('team-a', alice, 'member'), { ok: true })
    assert.deepEqual(setNamespaceGroupMember('team-a', 'Eng', 'member'), {
      ok: false,
      error: 'Cannot demote the last namespace Owner',
    })
    assert.deepEqual(removeNamespaceGroupMember('team-a', 'Eng'), {
      ok: false,
      error: 'Cannot remove the last namespace Owner',
    })
    assert.deepEqual(setNamespaceMember('team-a', alice, 'owner'), { ok: true })
    assert.deepEqual(removeNamespaceGroupMember('team-a', 'Eng'), { ok: true })
  })

  it('delete cascades members, collaborators and custom roles, leaving no orphans', () => {
    createNamespaceAuthz(alice, 'team-b', 'none')
    createNamespaceAuthz(alice, 'team-bb', 'none')
    setNamespaceMember('team-b', bob, 'member')
    setRepoCollaborator('team-b', 'r1', bob, 'read')
    setRepoGroupCollaborator('team-b', 'r2', 'eng', 'write')
    setRepoCollaborator('team-bb', 'r1', bob, 'read')
    createCustomNamespaceRole('team-b', { name: 'Auditor', permissions: [] })

    assert.deepEqual(deleteNamespaceAuthz('team-b'), { ok: true })

    assert.equal(getNamespace('team-b'), null)
    assert.deepEqual(listNamespaceMembers('team-b'), [])
    assert.deepEqual(listRepoCollaborators('team-b', 'r1'), [])
    assert.deepEqual(listRepoCollaborators('team-b', 'r2'), [])
    assert.deepEqual(listCustomNamespaceRoles('team-b'), [])
    assert.equal(listNamespaceMembers('team-bb').length, 1)
    assert.equal(listRepoCollaborators('team-bb', 'r1').length, 1)

    assert.deepEqual(deleteNamespaceAuthz('team-b'), { ok: false, error: 'Namespace not found' })
    createNamespaceAuthz(bob, 'team-b', 'none')
    assert.deepEqual(listNamespaceMembers('team-b'), [{ kind: 'user', sub: 'bob', iss: 'test', role: 'owner' }])
    assert.deepEqual(listRepoCollaborators('team-b', 'r1'), [])
  })

  it('a failed delete leaves every document intact', () => {
    createNamespaceAuthz(alice, 'team-c', 'none')
    setRepoCollaborator('team-c', 'r1', bob, 'read')
    assert.throws(() =>
      repo.deleteNamespace('team-c', {
        afterCommit() {
          throw new Error('boom')
        },
      }),
    )
    assert.ok(getNamespace('team-c'))
    assert.equal(listNamespaceMembers('team-c').length, 1)
    assert.equal(listRepoCollaborators('team-c', 'r1').length, 1)
  })
})
