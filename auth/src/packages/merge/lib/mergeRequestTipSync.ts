import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../../db/database.js'
import { mergeRequests } from '../../../db/schema.js'
import type { MergeRequestRecord, MergeRequestStatus } from './mergeRequestStore.js'

/** Dynamic import avoids a lib cycle with mergeRequestStore (re-exports removed). */
async function loadMergeRequest(id: string): Promise<MergeRequestRecord | null> {
  const { getMergeRequest } = await import('./mergeRequestStore.js')
  return getMergeRequest(id)
}

/**
 * Merge request tip sync — one interface for:
 * - reconcile against live tips (list/detail/signing-preview)
 * - mark open MRs stale when a watched tip moves (proxy fan-out, incl. commit.publish)
 * - Update (`refreshExpected`) re-pin both heads and reopen (allowed even if tips conflict)
 *
 * Export paths for #158 / proxy fan-out:
 *   `markOpenMergeRequestsStaleForTip`, `markOpenMergeRequestsStaleForPublishedCommit`,
 *   `reconcileMergeRequestAgainstLiveTips`, `resyncMergeRequest`
 *   from `./mergeRequestTipSync.js` or `merge/index.js`.
 */

/**
 * After a branch tip changes, mark open/stale MRs that pin that branch to a
 * different expected head as `stale`.
 */
export async function markOpenMergeRequestsStaleForTip(input: {
  repositoryId: string
  branch: string
  newTip: string
}): Promise<string[]> {
  const tip = input.newTip.trim()
  const branch = input.branch.trim()
  if (!tip || !branch) return []

  const candidates = await getDb()
    .select()
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.repositoryId, input.repositoryId),
        inArray(mergeRequests.status, ['open', 'stale']),
      ),
    )

  const staleIds: string[] = []
  const now = new Date()
  for (const row of candidates) {
    const asSource = row.sourceBranch === branch && row.expectedSourceHead !== tip
    const asTarget = row.targetBranch === branch && row.expectedTargetHead !== tip
    if (!asSource && !asTarget) continue
    if (row.status === 'stale') {
      staleIds.push(row.id)
      continue
    }
    await getDb()
      .update(mergeRequests)
      .set({ status: 'stale', updatedAt: now })
      .where(eq(mergeRequests.id, row.id))
    staleIds.push(row.id)
  }
  return staleIds
}

/**
 * `commit.publish` has no branch in the URL. After a successful publish, stale any
 * open/stale MR that pins a branch whose live tip is now the published commit.
 */
export async function markOpenMergeRequestsStaleForPublishedCommit(input: {
  repositoryId: string
  publishedCommit: string
  resolveLiveTip: (branch: string) => Promise<string | undefined>
}): Promise<string[]> {
  const tip = input.publishedCommit.trim()
  if (!tip) return []

  const candidates = await getDb()
    .select({
      sourceBranch: mergeRequests.sourceBranch,
      targetBranch: mergeRequests.targetBranch,
    })
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.repositoryId, input.repositoryId),
        inArray(mergeRequests.status, ['open', 'stale']),
      ),
    )

  const branches = new Set<string>()
  for (const row of candidates) {
    if (row.sourceBranch) branches.add(row.sourceBranch)
    if (row.targetBranch) branches.add(row.targetBranch)
  }

  const staleIds: string[] = []
  for (const branch of branches) {
    const live = await input.resolveLiveTip(branch)
    if (!live || live !== tip) continue
    const ids = await markOpenMergeRequestsStaleForTip({
      repositoryId: input.repositoryId,
      branch,
      newTip: tip,
    })
    for (const id of ids) {
      if (!staleIds.includes(id)) staleIds.push(id)
    }
  }
  return staleIds
}

/**
 * Compare live tips to expected; mark stale when they diverge (no refresh).
 * Used on list/detail so stale appears without an explicit resync call.
 */
export async function reconcileMergeRequestAgainstLiveTips(
  mr: MergeRequestRecord,
  live: { sourceHead: string; targetHead: string },
): Promise<MergeRequestRecord> {
  if (mr.status !== 'open' && mr.status !== 'stale') return mr
  return resyncMergeRequest(mr.id, {
    liveSourceHead: live.sourceHead,
    liveTargetHead: live.targetHead,
  })
}

/**
 * Update: compare live tips to expected heads.
 * When `refreshExpected` is true on a diverged MR, adopt live heads and reopen.
 */
export async function resyncMergeRequest(
  id: string,
  live: { liveSourceHead: string; liveTargetHead: string; refreshExpected?: boolean },
): Promise<MergeRequestRecord> {
  const current = await loadMergeRequest(id)
  if (!current) throw new Error('Merge request not found')
  // Only open/stale participate in tip reconciliation; cancelled/rejected/merged stay put.
  if (current.status !== 'open' && current.status !== 'stale') return current

  const headsMatch =
    live.liveSourceHead === current.expectedSourceHead &&
    live.liveTargetHead === current.expectedTargetHead

  let nextStatus: MergeRequestStatus = current.status
  let expectedSourceHead = current.expectedSourceHead
  let expectedTargetHead = current.expectedTargetHead

  if (!headsMatch) {
    if (live.refreshExpected) {
      expectedSourceHead = live.liveSourceHead
      expectedTargetHead = live.liveTargetHead
      nextStatus = 'open'
    } else {
      nextStatus = 'stale'
    }
  } else if (current.status === 'stale') {
    nextStatus = 'open'
  }

  await getDb()
    .update(mergeRequests)
    .set({
      status: nextStatus,
      expectedSourceHead,
      expectedTargetHead,
      updatedAt: new Date(),
    })
    .where(eq(mergeRequests.id, id))

  const updated = await loadMergeRequest(id)
  if (!updated) throw new Error('Merge request not found')
  return updated
}
