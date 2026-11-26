import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: Merge request tip sync (`mergeRequestTipSync`).
 * Catches: reconcile→stale, proactive mark-stale-for-tip (incl. commit.publish),
 * Update(refreshExpected) re-pin+reopen even when tips diverge / would conflict.
 * Misses: UI badge / Approve disabled (deep-ui).
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { openMergeRequest, getMergeRequest } = await import(
  '../../src/packages/merge/lib/mergeRequestStore.js'
)
const {
  reconcileMergeRequestAgainstLiveTips,
  markOpenMergeRequestsStaleForTip,
  markOpenMergeRequestsStaleForPublishedCommit,
  resyncMergeRequest,
} = await import('../../src/packages/merge/lib/mergeRequestTipSync.js')

const root = t.person('root')
await t.grantRole(root, 'manager')
assert.equal((await createNamespaceAuthz(root, 'lab', 'none')).ok, true)
const repo = await ensureRepository('lab', 'tip-sync')
assert.ok(repo)

describe('merge request tip sync', () => {
  it('reconcile marks open MR stale when live tips diverge', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'tip-sync',
      sourceBranch: 'feat-reconcile',
      targetBranch: 'main',
      expectedSourceHead: 's-old',
      expectedTargetHead: 't-old',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const next = await reconcileMergeRequestAgainstLiveTips(mr, {
      sourceHead: 's-old',
      targetHead: 't-new',
    })
    assert.equal(next.status, 'stale')
    assert.equal(next.expectedTargetHead, 't-old')
  })

  it('markOpenMergeRequestsStaleForTip stales MRs pinning a moved branch', async () => {
    const intoMain = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'tip-sync',
      sourceBranch: 'feat-a',
      targetBranch: 'main',
      expectedSourceHead: 'sa',
      expectedTargetHead: 'main-old',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const untouched = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'tip-sync',
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
    assert.equal((await getMergeRequest(untouched.id))?.status, 'open')
  })

  it('Update with refreshExpected re-pins both heads and reopens', async () => {
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'tip-sync',
      sourceBranch: 'feat-update',
      targetBranch: 'main',
      expectedSourceHead: 's1',
      expectedTargetHead: 't1',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const stale = await resyncMergeRequest(mr.id, {
      liveSourceHead: 's2',
      liveTargetHead: 't2',
    })
    assert.equal(stale.status, 'stale')

    const updated = await resyncMergeRequest(mr.id, {
      liveSourceHead: 's2',
      liveTargetHead: 't2',
      refreshExpected: true,
    })
    assert.equal(updated.status, 'open')
    assert.equal(updated.expectedSourceHead, 's2')
    assert.equal(updated.expectedTargetHead, 't2')
  })

  it('Update with refreshExpected is allowed even when new tips would conflict', async () => {
    // TipSync does not consult mergeability; Conflicts are surfaced separately.
    const mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'tip-sync',
      sourceBranch: 'feat-conflict',
      targetBranch: 'main',
      expectedSourceHead: 's-old',
      expectedTargetHead: 't-old',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    await resyncMergeRequest(mr.id, {
      liveSourceHead: 's-conflict',
      liveTargetHead: 't-conflict',
    })
    const updated = await resyncMergeRequest(mr.id, {
      liveSourceHead: 's-conflict',
      liveTargetHead: 't-conflict',
      refreshExpected: true,
    })
    assert.equal(updated.status, 'open')
    assert.equal(updated.expectedSourceHead, 's-conflict')
    assert.equal(updated.expectedTargetHead, 't-conflict')
  })

  it('markOpenMergeRequestsStaleForPublishedCommit stales MRs whose live tip is the publish', async () => {
    const intoMain = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'tip-sync',
      sourceBranch: 'feat-publish',
      targetBranch: 'main',
      expectedSourceHead: 'sa',
      expectedTargetHead: 'main-old',
      openedBy: { iss: root.iss, sub: root.sub },
    })
    const untouched = await openMergeRequest({
      repositoryId: repo.id,
      namespace: 'lab',
      repo: 'tip-sync',
      sourceBranch: 'other-pub',
      targetBranch: 'release',
      expectedSourceHead: 'o1',
      expectedTargetHead: 'r1',
      openedBy: { iss: root.iss, sub: root.sub },
    })

    const tips: Record<string, string> = {
      main: 'main-published',
      'feat-publish': 'sa',
      'other-pub': 'o1',
      release: 'r1',
    }
    const staleIds = await markOpenMergeRequestsStaleForPublishedCommit({
      repositoryId: repo.id,
      publishedCommit: 'main-published',
      resolveLiveTip: async (branch) => tips[branch],
    })
    assert.ok(staleIds.includes(intoMain.id))
    assert.equal((await getMergeRequest(intoMain.id))?.status, 'stale')
    assert.equal((await getMergeRequest(untouched.id))?.status, 'open')
  })
})
