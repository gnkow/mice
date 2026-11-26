import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../../db/database.js'
import { mergeRequests } from '../../../db/schema.js'
import { getMergeRequest, type MergeRequestRecord, type MergeRequestStatus } from './mergeRequestStore.js'

/**
 * Merge request tip sync — one interface for:
 * - reconcile against live tips (list/detail)
 * - mark open MRs stale when a watched tip moves
 * - Update (`refreshExpected`) re-pin both heads and reopen
 *
 * Export paths for #158 / proxy fan-out:
 *   `markOpenMergeRequestsStaleForTip`, `reconcileMergeRequestAgainstLiveTips`,
 *   `resyncMergeRequest` from `./mergeRequestTipSync.js` or `merge/index.js`.
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
  const current = await getMergeRequest(id)
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

  const updated = await getMergeRequest(id)
  if (!updated) throw new Error('Merge request not found')
  return updated
}
