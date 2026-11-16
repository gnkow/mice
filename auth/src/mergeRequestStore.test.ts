import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { ensureRepository } = await import('./repositoryStore.js')
const {
  openMergeRequest,
  getMergeRequest,
  listMergeRequests,
  resyncMergeRequest,
  markMergeRequestMerged,
  decideMergeRequestComplete,
} = await import('./mergeRequestStore.js')

const root = t.person('root')
await t.grantRole(root, 'manager')
assert.deepEqual(await createNamespaceAuthz(root, 'lab', 'none'), { ok: true })
const repo = await ensureRepository('lab', 'assay')
assert.ok(repo)

describe('merge request store (repositories/02)', () => {
  it('opens an MR with expected heads and lists it for the repository', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedSourceHead: 'aaa111',
      expectedTargetHead: 'bbb222',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    assert.equal(mr.status, 'open')
    assert.equal(mr.expectedSourceHead, 'aaa111')
    assert.equal(mr.expectedTargetHead, 'bbb222')
    const listed = await listMergeRequests(repo.id)
    assert.ok(listed.some((row) => row.id === mr.id))
    const got = await getMergeRequest(mr.id)
    assert.equal(got?.sourceBranch, 'feature')
  })

  it('resync marks stale when the target tip moved, then restores open with new heads', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'topic',
      targetBranch: 'main',
      expectedSourceHead: 's1',
      expectedTargetHead: 't1',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const stale = await resyncMergeRequest(mr.id, {
      liveSourceHead: 's1',
      liveTargetHead: 't2',
    })
    assert.equal(stale.status, 'stale')
    const openAgain = await resyncMergeRequest(mr.id, {
      liveSourceHead: 's1',
      liveTargetHead: 't2',
      refreshExpected: true,
    })
    assert.equal(openAgain.status, 'open')
    assert.equal(openAgain.expectedTargetHead, 't2')
  })

  it('complete decision refuses head mismatch and allows matching open MRs', () => {
    const id = randomUUID()
    const base = {
      id,
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'feature',
      targetBranch: 'main',
      expectedSourceHead: 'src',
      expectedTargetHead: 'tgt',
      status: 'open' as const,
      openedBy: `${root.iss}|${root.sub}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const mismatch = decideMergeRequestComplete(base, {
      liveSourceHead: 'src',
      liveTargetHead: 'other',
    })
    assert.equal(mismatch.ok, false)
    if (!mismatch.ok) assert.equal(mismatch.code, 'head_mismatch')

    const ok = decideMergeRequestComplete(base, {
      liveSourceHead: 'src',
      liveTargetHead: 'tgt',
    })
    assert.equal(ok.ok, true)
  })

  it('marks an MR merged after a successful complete', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'done',
      targetBranch: 'main',
      expectedSourceHead: 's',
      expectedTargetHead: 't',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const merged = await markMergeRequestMerged(mr.id, { mergeCommitId: 'merge-sha' })
    assert.equal(merged.status, 'merged')
    assert.equal(merged.mergeCommitId, 'merge-sha')
  })
})
