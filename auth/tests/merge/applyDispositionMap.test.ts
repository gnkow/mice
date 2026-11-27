import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: applyDispositionMap (ADR 0009 / Slice C).
 * Catches: self-Valid refuse; Invalid self allowed; override prior disposition + covering signature.
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { signerAuthorKey } = await import('../../src/packages/authentication/principal.js')
const {
  applyDispositionMap,
  applyBootstrapEmptyTipValid,
  getCommitQc,
  listCommitQcForSignature,
  listCommitQcEvents,
  markCommitsQc,
} = await import('../../src/packages/merge/lib/commitQcStore.js')

const actor = t.person('disp-actor')
await preparePrincipal(actor)
await t.grantRole(actor, 'manager')
assert.equal((await createNamespaceAuthz(actor, 'disp-lab', 'none')).ok, true)
const repo = await ensureRepository('disp-lab', 'data')
assert.ok(repo)

const actorKey = signerAuthorKey(actor)

describe('applyDispositionMap (ADR 0009)', () => {
  it('refuses Valid when the actor authored the commit', async () => {
    const result = await applyDispositionMap({
      repositoryId: repo.id,
      map: { 'own-1': 'valid' },
      signatureId: 'sig-self-valid',
      actor,
      authorsByCommitId: { 'own-1': [actorKey] },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'self_valid')
    assert.equal(result.status, 403)
    assert.equal(await getCommitQc(repo.id, 'own-1'), 'unset')
  })

  it('allows Invalid when the actor authored the commit', async () => {
    const result = await applyDispositionMap({
      repositoryId: repo.id,
      map: { 'own-2': 'invalid' },
      signatureId: 'sig-self-invalid',
      actor,
      authorsByCommitId: { 'own-2': [actorKey] },
    })
    assert.equal(result.ok, true)
    assert.equal(await getCommitQc(repo.id, 'own-2'), 'invalid')
    const covered = await listCommitQcForSignature('sig-self-invalid')
    assert.ok(covered.some((r) => r.commitId === 'own-2' && r.status === 'invalid'))
  })

  it('allows Valid for a non-author and overrides a prior disposition', async () => {
    await markCommitsQc(repo.id, ['other-1'], 'invalid')
    assert.equal(await getCommitQc(repo.id, 'other-1'), 'invalid')

    const result = await applyDispositionMap({
      repositoryId: repo.id,
      map: { 'other-1': 'valid' },
      signatureId: 'sig-override',
      actor,
      authorsByCommitId: { 'other-1': ['https://idp|someone-else'] },
    })
    assert.equal(result.ok, true)
    assert.equal(await getCommitQc(repo.id, 'other-1'), 'valid')
    const covered = await listCommitQcForSignature('sig-override')
    assert.ok(covered.some((r) => r.commitId === 'other-1' && r.signatureId === 'sig-override'))
  })
})

describe('applyBootstrapEmptyTipValid (create carve-out)', () => {
  it('Valids empty tips under the create signature even when the actor is the attributed author', async () => {
    const result = await applyBootstrapEmptyTipValid({
      repositoryId: repo.id,
      commitIds: ['empty-tip-1'],
      signatureId: 'sig-create-bootstrap',
      actor,
    })
    assert.equal(result.ok, true)
    assert.equal(await getCommitQc(repo.id, 'empty-tip-1'), 'valid')
    const covered = await listCommitQcForSignature('sig-create-bootstrap')
    assert.ok(
      covered.some((r) => r.commitId === 'empty-tip-1' && r.status === 'valid'),
    )
    const history = await listCommitQcEvents(repo.id, 'empty-tip-1')
    assert.equal(history[0]?.actorKey, actorKey)
    assert.equal(history[0]?.signatureId, 'sig-create-bootstrap')
  })

  it('refuses without a signature id', async () => {
    const result = await applyBootstrapEmptyTipValid({
      repositoryId: repo.id,
      commitIds: ['empty-tip-unsigned'],
      signatureId: '  ',
      actor,
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'signature_required')
    assert.equal(await getCommitQc(repo.id, 'empty-tip-unsigned'), 'unset')
  })
})
