import '../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { openMergeRequest } = await import('../../src/packages/merge/lib/commitQcStore.js')
const {
  getCommitQc,
  markCommitsQc,
  listCommitQcForRepo,
} = await import('../../src/packages/merge/lib/commitQcStore.js')

const root = t.person('root')
await t.grantRole(root, 'manager')
assert.equal((await createNamespaceAuthz(root, 'qc-lab', 'none')).ok, true)
const repo = await ensureRepository('qc-lab', 'data')
assert.ok(repo)

describe('commit QC status (repositories/03)', () => {
  it('defaults to none and marks commits when an MR opens', async () => {
    assert.equal(await getCommitQc(repo.id, 'c1'), 'none')
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'qc-lab',
      repo: 'data',
      sourceBranch: 'f',
      targetBranch: 'main',
      expectedSourceHead: 'c2',
      expectedTargetHead: 'c0',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    await markCommitsQc(repo.id, ['c1', 'c2'], 'marked', { mergeRequestId: mr.id })
    assert.equal(await getCommitQc(repo.id, 'c1'), 'marked')
    assert.equal(await getCommitQc(repo.id, 'c2'), 'marked')
    const listed = await listCommitQcForRepo(repo.id)
    assert.ok(listed.some((r) => r.commitId === 'c1' && r.status === 'marked'))
  })

  it('promotes marked commits to passed after a signed merge', async () => {
    await markCommitsQc(repo.id, ['m1'], 'marked')
    await markCommitsQc(repo.id, ['m1', 'merge-sha'], 'passed')
    assert.equal(await getCommitQc(repo.id, 'm1'), 'passed')
    assert.equal(await getCommitQc(repo.id, 'merge-sha'), 'passed')
  })

  it('keeps QC Failed until a new signature allows Failed→Passed (gxp/08)', async () => {
    await markCommitsQc(repo.id, ['fail-1'], 'failed')
    await markCommitsQc(repo.id, ['fail-1'], 'marked')
    assert.equal(await getCommitQc(repo.id, 'fail-1'), 'failed')

    await markCommitsQc(repo.id, ['fail-1'], 'passed')
    assert.equal(await getCommitQc(repo.id, 'fail-1'), 'failed')

    await markCommitsQc(repo.id, ['fail-1'], 'passed', { allowFailedToPassed: true })
    assert.equal(await getCommitQc(repo.id, 'fail-1'), 'passed')
  })
})
