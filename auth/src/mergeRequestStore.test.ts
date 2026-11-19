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
  rejectMergeRequest,
} = await import('./mergeRequestStore.js')

const root = t.person('root')
await t.grantRole(root, 'manager')
assert.equal((await createNamespaceAuthz(root, 'lab', 'none')).ok, true)
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
      title: 'Ship assay fix',
      description: 'Includes QC notes',
    })
    assert.equal(mr.status, 'open')
    assert.equal(mr.expectedSourceHead, 'aaa111')
    assert.equal(mr.expectedTargetHead, 'bbb222')
    assert.equal(mr.title, 'Ship assay fix')
    assert.equal(mr.description, 'Includes QC notes')
    const listed = await listMergeRequests(repo.id)
    assert.ok(listed.some((row) => row.id === mr.id))
    const got = await getMergeRequest(mr.id)
    assert.equal(got?.sourceBranch, 'feature')
    assert.equal(got?.title, 'Ship assay fix')
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

  it('rejects an open MR to blocked and refuses merged', async () => {
    const open = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'reject-me',
      targetBranch: 'main',
      expectedSourceHead: 'rs',
      expectedTargetHead: 'rt',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const rejected = await rejectMergeRequest(open.id)
    assert.equal(rejected.ok, true)
    if (rejected.ok) assert.equal(rejected.mergeRequest.status, 'blocked')

    const merged = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'already-merged',
      targetBranch: 'main',
      expectedSourceHead: 'ms',
      expectedTargetHead: 'mt',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    await markMergeRequestMerged(merged.id, { mergeCommitId: 'm1' })
    const refuse = await rejectMergeRequest(merged.id)
    assert.equal(refuse.ok, false)
    if (!refuse.ok) assert.equal(refuse.code, 'not_rejectable')
  })
})
