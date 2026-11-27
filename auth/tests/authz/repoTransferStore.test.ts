import '../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { setNamespaceMember, setNamespaceGroupMember } = await import(
  '../../src/packages/authz/lib/authzMembershipStore.js'
)
const { createOwnedRepository, readRepository } = await import(
  '../../src/packages/authz/lib/repositoryStore.js'
)
const {
  setRepoCollaborator,
  setRepoGroupCollaborator,
  listRepoCollaborators,
} = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { grantApprover, listApprovers } = await import('../../src/packages/authz/lib/authzApproverStore.js')
const { userKey } = await import('../../src/packages/authz/lib/authzTypes.js')
const {
  transferRepository,
  proposeRepositoryTransfer,
  acceptRepositoryTransfer,
  cancelRepositoryTransfer,
  getPendingRepositoryTransfer,
  expirePendingTransfers,
  backdatePendingTransfer,
  TRANSFER_PENDING_TTL_MS,
} = await import('../../src/packages/authz/lib/authzRepoTransfer.js')
const { defaultGroupIssuer } = await import('../../src/packages/authz/lib/groupIssuer.js')
const { toGroupBindingKey } = await import('../../src/packages/authz/lib/groupBinding.js')

const alice = t.person('xfer-alice')
const bob = t.person('xfer-bob')
const carol = t.person('xfer-carol')

describe('transferRepository store', () => {
  it('re-points namespaceId on the stable repository id', async () => {
    assert.equal((await createNamespaceAuthz(alice, 'xfer-src', 'none')).ok, true)
    assert.equal((await createNamespaceAuthz(alice, 'xfer-dst', 'none')).ok, true)
    const created = await createOwnedRepository('xfer-src', 'assay', userKey(alice))
    assert.ok(created)

    const result = await transferRepository('xfer-src', 'assay', 'xfer-dst', {
      mode: 'one-shot',
      actorKey: userKey(alice),
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.repository.id, created.id)
    assert.equal(result.repository.namespace, 'xfer-dst')
    assert.equal(await readRepository('xfer-src', 'assay'), null)
    const moved = await readRepository('xfer-dst', 'assay')
    assert.ok(moved)
    assert.equal(moved.id, created.id)
  })

  it('keeps dest-member collaborators/approvers and drops the rest', async () => {
    assert.equal((await createNamespaceAuthz(alice, 'filt-src', 'none')).ok, true)
    assert.equal((await createNamespaceAuthz(alice, 'filt-dst', 'read')).ok, true)
    await setNamespaceMember('filt-dst', bob, 'member')
    const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const binding = toGroupBindingKey(defaultGroupIssuer(), groupId)
    assert.equal((await setNamespaceGroupMember('filt-dst', groupId, 'member')).ok, true)

    assert.ok(await createOwnedRepository('filt-src', 'data', userKey(alice)))
    await setRepoCollaborator('filt-src', 'data', bob, 'write')
    await setRepoCollaborator('filt-src', 'data', carol, 'read')
    assert.equal((await setRepoGroupCollaborator('filt-src', 'data', groupId, 'maintain')).ok, true)
    await grantApprover({ ns: 'filt-src', repo: 'data' }, bob)
    await grantApprover({ ns: 'filt-src', repo: 'data' }, carol)

    const result = await transferRepository('filt-src', 'data', 'filt-dst', {
      mode: 'one-shot',
      actorKey: userKey(alice),
    })
    assert.equal(result.ok, true)
    if (!result.ok) return

    const collabs = await listRepoCollaborators('filt-dst', 'data')
    assert.deepEqual(
      collabs
        .map((c) => (c.kind === 'user' ? `user:${c.sub}` : `group:${c.group}`))
        .sort(),
      [`group:${binding.bindingKey}`, 'user:xfer-bob'].sort(),
    )
    const approvers = await listApprovers({ ns: 'filt-dst', repo: 'data' })
    assert.deepEqual(
      approvers.map((a) => (a.kind === 'user' ? a.sub : a.group)).sort(),
      ['xfer-bob'],
    )
    assert.ok(result.accessDiff.dropped.some((s) => s.key === userKey(carol)))
    // Dest Owner alice is a member but not a kept collaborator → newly inheriting warning.
    assert.ok(result.accessDiff.newlyInheriting.some((s) => s.key === userKey(alice)))
    // Bob was kept as collaborator, so he is not listed as newly inheriting.
    assert.ok(!result.accessDiff.newlyInheriting.some((s) => s.key === userKey(bob)))
  })

  it('refuses same-namespace and name collision', async () => {
    assert.equal((await createNamespaceAuthz(alice, 'same-src', 'none')).ok, true)
    assert.equal((await createNamespaceAuthz(alice, 'same-dst', 'none')).ok, true)
    assert.ok(await createOwnedRepository('same-src', 'r1', userKey(alice)))
    assert.ok(await createOwnedRepository('same-dst', 'r1', userKey(alice)))

    assert.deepEqual(await transferRepository('same-src', 'r1', 'same-src'), {
      ok: false,
      error: 'Cannot transfer to the same namespace',
      code: 'same_namespace',
    })
    const collision = await transferRepository('same-src', 'r1', 'same-dst')
    assert.equal(collision.ok, false)
    if (!collision.ok) assert.equal(collision.code, 'name_collision')
  })
})

describe('propose / pending / accept / expiry', () => {
  it('one-shots when initiator is also dest Owner; otherwise stays pending', async () => {
    assert.equal((await createNamespaceAuthz(alice, 'own-src', 'none')).ok, true)
    assert.equal((await createNamespaceAuthz(alice, 'own-dst', 'none')).ok, true)
    assert.ok(await createOwnedRepository('own-src', 'shared', userKey(alice)))

    const oneShot = await proposeRepositoryTransfer({
      ns: 'own-src',
      name: 'shared',
      targetNamespace: 'own-dst',
      proposedBy: userKey(alice),
      initiatorIsDestOwner: true,
    })
    assert.equal(oneShot.ok, true)
    if (!oneShot.ok) return
    assert.equal(oneShot.mode, 'one-shot')
    assert.equal(await getPendingRepositoryTransfer('own-src', 'shared'), null)
    assert.ok(await readRepository('own-dst', 'shared'))
  })

  it('refuses a second propose while pending; accept completes; cancel clears', async () => {
    assert.equal((await createNamespaceAuthz(alice, 'pend-src', 'none')).ok, true)
    assert.equal((await createNamespaceAuthz(bob, 'pend-dst', 'none')).ok, true)
    assert.ok(await createOwnedRepository('pend-src', 'study', userKey(alice)))

    const proposed = await proposeRepositoryTransfer({
      ns: 'pend-src',
      name: 'study',
      targetNamespace: 'pend-dst',
      proposedBy: userKey(alice),
      initiatorIsDestOwner: false,
    })
    assert.equal(proposed.ok, true)
    if (!proposed.ok) return
    assert.equal(proposed.mode, 'pending')

    const second = await proposeRepositoryTransfer({
      ns: 'pend-src',
      name: 'study',
      targetNamespace: 'pend-dst',
      proposedBy: userKey(alice),
      initiatorIsDestOwner: false,
    })
    assert.equal(second.ok, false)
    if (!second.ok) assert.equal(second.code, 'pending_exists')

    const accepted = await acceptRepositoryTransfer({
      ns: 'pend-src',
      name: 'study',
      actorKey: userKey(bob),
    })
    assert.equal(accepted.ok, true)
    assert.ok(await readRepository('pend-dst', 'study'))
    assert.equal(await getPendingRepositoryTransfer('pend-src', 'study'), null)
  })

  it('expires pending transfers after 7 days as auto-cancel', async () => {
    assert.equal((await createNamespaceAuthz(alice, 'exp-src', 'none')).ok, true)
    assert.equal((await createNamespaceAuthz(bob, 'exp-dst', 'none')).ok, true)
    assert.ok(await createOwnedRepository('exp-src', 'old', userKey(alice)))

    const proposed = await proposeRepositoryTransfer({
      ns: 'exp-src',
      name: 'old',
      targetNamespace: 'exp-dst',
      proposedBy: userKey(alice),
      initiatorIsDestOwner: false,
    })
    assert.equal(proposed.ok, true)
    if (!proposed.ok || proposed.mode !== 'pending') return

    await backdatePendingTransfer(
      proposed.transfer.id,
      new Date(Date.now() - TRANSFER_PENDING_TTL_MS - 1000),
    )
    const expired = await expirePendingTransfers({ now: Date.now() })
    assert.ok(expired.some((e) => e.id === proposed.transfer.id))
    assert.equal(await getPendingRepositoryTransfer('exp-src', 'old'), null)
    assert.ok(await readRepository('exp-src', 'old'))

    const cancelSetup = await proposeRepositoryTransfer({
      ns: 'exp-src',
      name: 'old',
      targetNamespace: 'exp-dst',
      proposedBy: userKey(alice),
      initiatorIsDestOwner: false,
    })
    assert.equal(cancelSetup.ok, true)
    const cancelled = await cancelRepositoryTransfer({
      ns: 'exp-src',
      name: 'old',
      actorKey: userKey(alice),
    })
    assert.equal(cancelled.ok, true)
    assert.equal(await getPendingRepositoryTransfer('exp-src', 'old'), null)
  })
})
