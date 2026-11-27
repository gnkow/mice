import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const {
  getCommitQc,
  markCommitsQc,
  listCommitQcForRepo,
  applyDispositionMap,
} = await import('../../src/packages/merge/lib/commitQcStore.js')

const root = t.person('root')
await t.grantRole(root, 'manager')
assert.equal((await createNamespaceAuthz(root, 'qc-lab', 'none')).ok, true)
const repo = await ensureRepository('qc-lab', 'data')
assert.ok(repo)

describe('commit QC disposition (ADR 0009)', () => {
  it('defaults to unset', async () => {
    assert.equal(await getCommitQc(repo.id, 'c1'), 'unset')
  })

  it('upserts valid/invalid via markCommitsQc', async () => {
    await markCommitsQc(repo.id, ['m1', 'merge-sha'], 'valid')
    assert.equal(await getCommitQc(repo.id, 'm1'), 'valid')
    assert.equal(await getCommitQc(repo.id, 'merge-sha'), 'valid')
    const listed = await listCommitQcForRepo(repo.id)
    assert.ok(listed.some((r) => r.commitId === 'm1' && r.status === 'valid'))
  })

  it('allows override of invalid→valid via disposition map', async () => {
    await markCommitsQc(repo.id, ['fail-1'], 'invalid')
    assert.equal(await getCommitQc(repo.id, 'fail-1'), 'invalid')

    const applied = await applyDispositionMap({
      repositoryId: repo.id,
      map: { 'fail-1': 'valid' },
      signatureId: 'sig-restore',
      actor: root,
      authorsByCommitId: { 'fail-1': ['https://other|scientist'] },
    })
    assert.equal(applied.ok, true)
    assert.equal(await getCommitQc(repo.id, 'fail-1'), 'valid')
  })
})
