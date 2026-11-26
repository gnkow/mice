import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../../db/database.js'
import { mergeRequests } from '../../../db/schema.js'
import { principalKey } from '../../authentication/principal.js'

export type MergeRequestStatus = 'open' | 'stale' | 'merged' | 'rejected' | 'cancelled'

/**
 * Statuses that occupy a source→target pair. Only `merged` frees the pair for a
 * new request; open/stale/cancelled/rejected must be updated, reopened, or
 * reject-reverted on the existing row.
 */
const PAIR_BLOCKING_STATUSES: MergeRequestStatus[] = [
  'open',
  'stale',
  'cancelled',
  'rejected',
]

/** A non-merged MR already covers this source→target pair. */
export class MergeRequestAlreadyOpenError extends Error {
  readonly code = 'already_open' as const
  constructor(readonly existingId: string) {
    super(
      'A merge request for this source and target branch already exists. Open, reopen, or revert that request instead of creating another.',
    )
    this.name = 'MergeRequestAlreadyOpenError'
  }
}

export type MergeRequestRecord = {
  id: string
  repositoryId: string
  namespace: string
  repo: string
  sourceBranch: string
  targetBranch: string
  expectedSourceHead: string
  expectedTargetHead: string
  status: MergeRequestStatus
  openedBy: string
  title: string
  description: string
  mergeCommitId: string | null
  createdAt: Date
  updatedAt: Date
}

export function defaultMergeRequestTitle(sourceBranch: string, targetBranch: string): string {
  return `${sourceBranch} → ${targetBranch}`
}

function rowToRecord(row: typeof mergeRequests.$inferSelect): MergeRequestRecord {
  const title = row.title?.trim() || defaultMergeRequestTitle(row.sourceBranch, row.targetBranch)
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    namespace: row.namespace,
    repo: row.repo,
    sourceBranch: row.sourceBranch,
    targetBranch: row.targetBranch,
    expectedSourceHead: row.expectedSourceHead,
    expectedTargetHead: row.expectedTargetHead,
    // Legacy rows used `blocked`; normalize to `rejected`.
    status: (row.status === 'blocked' ? 'rejected' : row.status) as MergeRequestStatus,
    openedBy: row.openedBy,
    title,
    description: row.description ?? '',
    mergeCommitId: row.mergeCommitId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function openMergeRequest(input: {
  repositoryId: string
  namespace: string
  repo: string
  sourceBranch: string
  targetBranch: string
  expectedSourceHead: string
  expectedTargetHead: string
  openedBy: { iss: string; sub: string }
  title?: string
  description?: string
}): Promise<MergeRequestRecord> {
  const existing = await getDb()
    .select({ id: mergeRequests.id })
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.repositoryId, input.repositoryId),
        eq(mergeRequests.sourceBranch, input.sourceBranch),
        eq(mergeRequests.targetBranch, input.targetBranch),
        inArray(mergeRequests.status, PAIR_BLOCKING_STATUSES),
      ),
    )
    .limit(1)
  if (existing[0]) {
    throw new MergeRequestAlreadyOpenError(existing[0].id)
  }

  const now = new Date()
  const title =
    input.title?.trim() ||
    defaultMergeRequestTitle(input.sourceBranch, input.targetBranch)
  const description = input.description?.trim() ?? ''
  const [inserted] = await getDb()
    .insert(mergeRequests)
    .values({
      repositoryId: input.repositoryId,
      namespace: input.namespace,
      repo: input.repo,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      expectedSourceHead: input.expectedSourceHead,
      expectedTargetHead: input.expectedTargetHead,
      status: 'open',
      openedBy: principalKey(input.openedBy),
      title,
      description,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return rowToRecord(inserted!)
}

export async function getMergeRequest(id: string): Promise<MergeRequestRecord | null> {
  const rows = await getDb().select().from(mergeRequests).where(eq(mergeRequests.id, id)).limit(1)
  return rows[0] ? rowToRecord(rows[0]) : null
}

export async function listMergeRequests(repositoryId: string): Promise<MergeRequestRecord[]> {
  const rows = await getDb()
    .select()
    .from(mergeRequests)
    .where(eq(mergeRequests.repositoryId, repositoryId))
    .orderBy(desc(mergeRequests.createdAt))
  return rows.map(rowToRecord)
}

/**
 * After a branch tip changes, mark open/stale MRs that pin that branch to a
 * different expected head as `stale` (repositories/#158).
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
    const asSource =
      row.sourceBranch === branch && row.expectedSourceHead !== tip
    const asTarget =
      row.targetBranch === branch && row.expectedTargetHead !== tip
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
 * Compare live tips to expected heads. Target tip move → stale.
 * When `refreshExpected` is true on a stale MR, adopt live heads and reopen.
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

  const [updated] = await getDb()
    .update(mergeRequests)
    .set({
      status: nextStatus,
      expectedSourceHead,
      expectedTargetHead,
      updatedAt: new Date(),
    })
    .where(eq(mergeRequests.id, id))
    .returning()
  return rowToRecord(updated!)
}

export function decideMergeRequestComplete(
  mr: Pick<MergeRequestRecord, 'status' | 'expectedSourceHead' | 'expectedTargetHead'>,
  live: { liveSourceHead: string; liveTargetHead: string },
): { ok: true } | { ok: false; code: 'not_open' | 'head_mismatch' } {
  if (mr.status !== 'open') return { ok: false, code: 'not_open' }
  if (
    live.liveSourceHead !== mr.expectedSourceHead ||
    live.liveTargetHead !== mr.expectedTargetHead
  ) {
    return { ok: false, code: 'head_mismatch' }
  }
  return { ok: true }
}

export async function markMergeRequestMerged(
  id: string,
  opts: { mergeCommitId: string },
): Promise<MergeRequestRecord> {
  const [updated] = await getDb()
    .update(mergeRequests)
    .set({
      status: 'merged',
      mergeCommitId: opts.mergeCommitId,
      updatedAt: new Date(),
    })
    .where(and(eq(mergeRequests.id, id)))
    .returning()
  if (!updated) throw new Error('Merge request not found')
  return rowToRecord(updated)
}

async function closeMergeRequest(
  id: string,
  status: 'rejected' | 'cancelled',
): Promise<
  | { ok: true; mergeRequest: MergeRequestRecord }
  | { ok: false; code: 'not_found' | 'not_closeable' }
> {
  const current = await getMergeRequest(id)
  if (!current) return { ok: false, code: 'not_found' }
  if (current.status !== 'open' && current.status !== 'stale') {
    return { ok: false, code: 'not_closeable' }
  }
  const [updated] = await getDb()
    .update(mergeRequests)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(mergeRequests.id, id))
    .returning()
  if (!updated) return { ok: false, code: 'not_found' }
  return { ok: true, mergeRequest: rowToRecord(updated) }
}

/** Approver refuse: open/stale → rejected. */
export async function rejectMergeRequest(
  id: string,
): Promise<
  | { ok: true; mergeRequest: MergeRequestRecord }
  | { ok: false; code: 'not_found' | 'not_rejectable' }
> {
  const result = await closeMergeRequest(id, 'rejected')
  if (!result.ok) {
    return { ok: false, code: result.code === 'not_closeable' ? 'not_rejectable' : result.code }
  }
  return result
}

/** Writer withdraw: open/stale → cancelled. */
export async function cancelMergeRequest(
  id: string,
): Promise<
  | { ok: true; mergeRequest: MergeRequestRecord }
  | { ok: false; code: 'not_found' | 'not_cancellable' }
> {
  const result = await closeMergeRequest(id, 'cancelled')
  if (!result.ok) {
    return { ok: false, code: result.code === 'not_closeable' ? 'not_cancellable' : result.code }
  }
  return result
}

/**
 * Restore a withdrawn or refused request to open (or stale when live tips diverge).
 * - cancelled → writer reopen
 * - rejected → Approver reverts the refuse (route enforces Approver)
 * Optionally refresh expected heads from live tips (same idea as Update).
 */
export async function reopenMergeRequest(
  id: string,
  live?: { liveSourceHead?: string; liveTargetHead?: string; refreshExpected?: boolean },
): Promise<
  | { ok: true; mergeRequest: MergeRequestRecord }
  | { ok: false; code: 'not_found' | 'not_reopenable' | 'already_open'; existingId?: string }
> {
  const current = await getMergeRequest(id)
  if (!current) return { ok: false, code: 'not_found' }
  if (current.status !== 'cancelled' && current.status !== 'rejected') {
    return { ok: false, code: 'not_reopenable' }
  }

  // Another non-merged MR for the same pair blocks reopen (exclude self).
  const conflict = await getDb()
    .select({ id: mergeRequests.id })
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.repositoryId, current.repositoryId),
        eq(mergeRequests.sourceBranch, current.sourceBranch),
        eq(mergeRequests.targetBranch, current.targetBranch),
        inArray(mergeRequests.status, PAIR_BLOCKING_STATUSES),
      ),
    )
    .limit(1)
  if (conflict[0] && conflict[0].id !== current.id) {
    return { ok: false, code: 'already_open', existingId: conflict[0].id }
  }

  let expectedSourceHead = current.expectedSourceHead
  let expectedTargetHead = current.expectedTargetHead
  let nextStatus: MergeRequestStatus = 'open'
  const liveSource = live?.liveSourceHead?.trim() ?? ''
  const liveTarget = live?.liveTargetHead?.trim() ?? ''
  if (liveSource && liveTarget) {
    if (live?.refreshExpected) {
      expectedSourceHead = liveSource
      expectedTargetHead = liveTarget
      nextStatus = 'open'
    } else if (
      liveSource !== expectedSourceHead ||
      liveTarget !== expectedTargetHead
    ) {
      nextStatus = 'stale'
    }
  }

  const [updated] = await getDb()
    .update(mergeRequests)
    .set({
      status: nextStatus,
      expectedSourceHead,
      expectedTargetHead,
      updatedAt: new Date(),
    })
    .where(eq(mergeRequests.id, id))
    .returning()
  if (!updated) return { ok: false, code: 'not_found' }
  return { ok: true, mergeRequest: rowToRecord(updated) }
}
