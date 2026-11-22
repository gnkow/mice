import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { setNamespaceMember } = await import('./authzMembershipStore.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { decideRepoViewerPermissions } = await import('./repoViewerPermissions.js')

const NS = 'viewer-perms-ns'
const REPO = 'study'

const owner = t.person('viewer-owner')
const reader = t.person('viewer-reader')
await preparePrincipal(owner)
await preparePrincipal(reader)
assert.equal((await createNamespaceAuthz(owner, NS, 'none', true)).ok, true)
assert.equal((await setNamespaceMember(NS, owner, 'owner')).ok, true)
assert.equal((await setRepoCollaborator(NS, REPO, reader, 'read')).ok, true)

describe('decideRepoViewerPermissions (#148)', () => {
  it('gives the Owner mutate chrome for rename/transfer/collaborators/approvers/delete', async () => {
    const r = await decideRepoViewerPermissions(owner, NS, REPO)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.permissions.rename, true)
    assert.equal(r.permissions.transfer, true)
    assert.equal(r.permissions.manageCollaborators, true)
    assert.equal(r.permissions.manageApprovers, true)
    assert.equal(r.permissions.deleteRepository, true)
    assert.equal(r.permissions.viewSignedRecord, true)
    assert.equal(r.permissions.editMetadata, true)
  })

  it('hides mutate chrome for a read-only collaborator (approvers stay non-writable)', async () => {
    const r = await decideRepoViewerPermissions(reader, NS, REPO)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.permissions.rename, false)
    assert.equal(r.permissions.transfer, false)
    assert.equal(r.permissions.manageCollaborators, false)
    assert.equal(r.permissions.manageApprovers, false)
    assert.equal(r.permissions.deleteRepository, false)
    assert.equal(r.permissions.editMetadata, false)
    assert.equal(r.permissions.viewSignedRecord, true)
  })

  it('refuses a principal with no repo read', async () => {
    const stranger = t.person('viewer-stranger')
    await preparePrincipal(stranger)
    const r = await decideRepoViewerPermissions(stranger, NS, REPO)
    assert.deepEqual(r, { ok: false, status: 403 })
  })
})
