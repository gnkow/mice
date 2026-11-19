import { and, desc, eq } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { mergeRequests } from './db/schema.js'
import { principalKey } from './authentication/session/principal.js'

export type MergeRequestStatus = 'open' | 'stale' | 'merged' | 'blocked'

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
    status: row.status as MergeRequestStatus,
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
 * Compare live tips to expected heads. Target tip move → stale.
 * When `refreshExpected` is true on a stale MR, adopt live heads and reopen.
 */
export async function resyncMergeRequest(
  id: string,
  live: { liveSourceHead: string; liveTargetHead: string; refreshExpected?: boolean },
): Promise<MergeRequestRecord> {
  const current = await getMergeRequest(id)
  if (!current) throw new Error('Merge request not found')
  if (current.status === 'merged') return current

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

/**
 * Operator reject: open/stale → blocked. Merged MRs are left alone.
 */
export async function rejectMergeRequest(
  id: string,
): Promise<
  | { ok: true; mergeRequest: MergeRequestRecord }
  | { ok: false; code: 'not_found' | 'not_rejectable' }
> {
  const current = await getMergeRequest(id)
  if (!current) return { ok: false, code: 'not_found' }
  if (current.status !== 'open' && current.status !== 'stale') {
    return { ok: false, code: 'not_rejectable' }
  }
  const [updated] = await getDb()
    .update(mergeRequests)
    .set({
      status: 'blocked',
      updatedAt: new Date(),
    })
    .where(eq(mergeRequests.id, id))
    .returning()
  if (!updated) return { ok: false, code: 'not_found' }
  return { ok: true, mergeRequest: rowToRecord(updated) }
}
