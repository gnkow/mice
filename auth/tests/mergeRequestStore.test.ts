import '../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { isolatedAuth } from '../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../src/packages/authz/lib/repositoryStore.js')
const {
  openMergeRequest,
  getMergeRequest,
  listMergeRequests,
  markMergeRequestMerged,
  decideMergeRequestComplete,
  rejectMergeRequest,
  cancelMergeRequest,
  reopenMergeRequest,
  MergeRequestAlreadyOpenError,
} = await import('../src/packages/merge/lib/mergeRequestStore.js')
const { resyncMergeRequest, markOpenMergeRequestsStaleForTip } = await import(
  '../src/packages/merge/lib/mergeRequestTipSync.js'
)

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

  it('refuses a second open MR for the same source→target while one is open, stale, cancelled, or rejected', async () => {
    const first = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'test',
      targetBranch: 'main',
      expectedSourceHead: 'src-dup',
      expectedTargetHead: 'tgt-dup',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    await assert.rejects(
      () =>
        openMergeRequest({
          repositoryId: repo.id,
          namespace: 'lab',
          repo: 'assay',
          sourceBranch: 'test',
          targetBranch: 'main',
          expectedSourceHead: 'src-dup',
          expectedTargetHead: 'tgt-dup',
          openedBy: { iss: root.iss, sub: root.sub },
        }),
      (err: unknown) =>
        err instanceof MergeRequestAlreadyOpenError && err.existingId === first.id,
    )
    await resyncMergeRequest(first.id, {
      liveSourceHead: 'src-dup',
      liveTargetHead: 'tgt-moved',
    })
    await assert.rejects(
      () =>
        openMergeRequest({
          repositoryId: repo.id,
          namespace: 'lab',
          repo: 'assay',
          sourceBranch: 'test',
          targetBranch: 'main',
          expectedSourceHead: 'src-2',
          expectedTargetHead: 'tgt-2',
          openedBy: { iss: root.iss, sub: root.sub },
        }),
      (err: unknown) => err instanceof MergeRequestAlreadyOpenError,
    )
    const cancelled = await cancelMergeRequest(first.id)
    assert.equal(cancelled.ok, true)
    await assert.rejects(
      () =>
        openMergeRequest({
          repositoryId: repo.id,
          namespace: 'lab',
          repo: 'assay',
          sourceBranch: 'test',
          targetBranch: 'main',
          expectedSourceHead: 'src-3',
          expectedTargetHead: 'tgt-3',
          openedBy: { iss: root.iss, sub: root.sub },
        }),
      (err: unknown) =>
        err instanceof MergeRequestAlreadyOpenError && err.existingId === first.id,
    )
  })

  it('resync leaves rejected and cancelled unchanged (gxp/08)', async () => {
    const open = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'resync-reject',
      targetBranch: 'main',
      expectedSourceHead: 'rr-s',
      expectedTargetHead: 'rr-t',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    assert.equal((await rejectMergeRequest(open.id)).ok, true)
    const stillRejected = await resyncMergeRequest(open.id, {
      liveSourceHead: 'rr-s2',
      liveTargetHead: 'rr-t2',
      refreshExpected: true,
    })
    assert.equal(stillRejected.status, 'rejected')
    assert.equal(stillRejected.expectedSourceHead, 'rr-s')

    const cancelledOpen = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'resync-cancel',
      targetBranch: 'main',
      expectedSourceHead: 'rc-s',
      expectedTargetHead: 'rc-t',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    assert.equal((await cancelMergeRequest(cancelledOpen.id)).ok, true)
    const stillCancelled = await resyncMergeRequest(cancelledOpen.id, {
      liveSourceHead: 'rc-s2',
      liveTargetHead: 'rc-t2',
      refreshExpected: true,
    })
    assert.equal(stillCancelled.status, 'cancelled')
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

  it('proactively marks open MRs stale when a watched branch tip moves', async () => {
    const intoMain = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'feat-a',
      targetBranch: 'main',
      expectedSourceHead: 'sa',
      expectedTargetHead: 'main-old',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const fromFeat = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'feat-b',
      targetBranch: 'develop',
      expectedSourceHead: 'feat-b-old',
      expectedTargetHead: 'dev-tip',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const untouched = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'other',
      targetBranch: 'release',
      expectedSourceHead: 'o1',
      expectedTargetHead: 'r1',
      openedBy: { iss: root.iss, sub: root.sub },
    })

    const staleIds = await markOpenMergeRequestsStaleForTip({
      repositoryId: repo.id,
      branch: 'main',
      newTip: 'main-new',
    })
    assert.ok(staleIds.includes(intoMain.id))
    assert.equal((await getMergeRequest(intoMain.id))?.status, 'stale')
    assert.equal((await getMergeRequest(fromFeat.id))?.status, 'open')
    assert.equal((await getMergeRequest(untouched.id))?.status, 'open')

    const sourceMoved = await markOpenMergeRequestsStaleForTip({
      repositoryId: repo.id,
      branch: 'feat-b',
      newTip: 'feat-b-new',
    })
    assert.ok(sourceMoved.includes(fromFeat.id))
    assert.equal((await getMergeRequest(fromFeat.id))?.status, 'stale')
    assert.equal((await getMergeRequest(untouched.id))?.status, 'open')
  })

  it('rejects an open MR to rejected and refuses merged', async () => {
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
    if (rejected.ok) assert.equal(rejected.mergeRequest.status, 'rejected')

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

  it('cancels an open MR to cancelled', async () => {
    const open = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'cancel-me',
      targetBranch: 'main',
      expectedSourceHead: 'cs',
      expectedTargetHead: 'ct',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const cancelled = await cancelMergeRequest(open.id)
    assert.equal(cancelled.ok, true)
    if (cancelled.ok) assert.equal(cancelled.mergeRequest.status, 'cancelled')
  })

  it('reopens cancelled to open', async () => {
    const open = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'reopen-me',
      targetBranch: 'main',
      expectedSourceHead: 'ros',
      expectedTargetHead: 'rot',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const cancelled = await cancelMergeRequest(open.id)
    assert.equal(cancelled.ok, true)

    const reopened = await reopenMergeRequest(open.id, {
      liveSourceHead: 'ros2',
      liveTargetHead: 'rot2',
      refreshExpected: true,
    })
    assert.equal(reopened.ok, true)
    if (reopened.ok) {
      assert.equal(reopened.mergeRequest.status, 'open')
      assert.equal(reopened.mergeRequest.expectedSourceHead, 'ros2')
      assert.equal(reopened.mergeRequest.expectedTargetHead, 'rot2')
    }
  })

  it('rejected blocks a new open for the same pair until Approver reverts', async () => {
    const open = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'assay',
      sourceBranch: 'reject-blocks',
      targetBranch: 'main',
      expectedSourceHead: 'rbs',
      expectedTargetHead: 'rbt',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const rejected = await rejectMergeRequest(open.id)
    assert.equal(rejected.ok, true)

    await assert.rejects(
      () =>
        openMergeRequest({
          repositoryId: repo.id,
          namespace: 'lab',
          repo: 'assay',
          sourceBranch: 'reject-blocks',
          targetBranch: 'main',
          expectedSourceHead: 'rbs2',
          expectedTargetHead: 'rbt2',
          openedBy: { iss: root.iss, sub: root.sub },
        }),
      (err: unknown) =>
        err instanceof MergeRequestAlreadyOpenError && err.existingId === open.id,
    )

    const reverted = await reopenMergeRequest(open.id, {
      liveSourceHead: 'rbs3',
      liveTargetHead: 'rbt3',
      refreshExpected: true,
    })
    assert.equal(reverted.ok, true)
    if (reverted.ok) {
      assert.equal(reverted.mergeRequest.status, 'open')
      assert.equal(reverted.mergeRequest.expectedSourceHead, 'rbs3')
    }
  })
})
