import { and, eq } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { commitQcStatus } from './db/schema.js'

export type CommitQc = 'none' | 'marked' | 'passed' | 'failed'

export type CommitQcRow = {
  repositoryId: string
  commitId: string
  status: CommitQc
  mergeRequestId: string | null
  updatedAt: Date
}

export async function getCommitQc(repositoryId: string, commitId: string): Promise<CommitQc> {
  const rows = await getDb()
    .select()
    .from(commitQcStatus)
    .where(
      and(eq(commitQcStatus.repositoryId, repositoryId), eq(commitQcStatus.commitId, commitId)),
    )
    .limit(1)
  return (rows[0]?.status as CommitQc | undefined) ?? 'none'
}

export async function listCommitQcForRepo(repositoryId: string): Promise<CommitQcRow[]> {
  const rows = await getDb()
    .select()
    .from(commitQcStatus)
    .where(eq(commitQcStatus.repositoryId, repositoryId))
  return rows.map((r) => ({
    repositoryId: r.repositoryId,
    commitId: r.commitId,
    status: r.status as CommitQc,
    mergeRequestId: r.mergeRequestId ?? null,
    updatedAt: r.updatedAt,
  }))
}

/**
 * Upsert QC status for many commits (branch-invariant).
 * QC Failed → Passed is only allowed via `allowFailedToPassed` (signed merge / gxp/08).
 */
export async function markCommitsQc(
  repositoryId: string,
  commitIds: string[],
  status: Exclude<CommitQc, 'none'>,
  opts?: { mergeRequestId?: string; allowFailedToPassed?: boolean },
): Promise<void> {
  const now = new Date()
  for (const commitId of commitIds) {
    if (status === 'passed' && !opts?.allowFailedToPassed) {
      const current = await getCommitQc(repositoryId, commitId)
      if (current === 'failed') continue
    }
    await getDb()
      .insert(commitQcStatus)
      .values({
        repositoryId,
        commitId,
        status,
        mergeRequestId: opts?.mergeRequestId ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [commitQcStatus.repositoryId, commitQcStatus.commitId],
        set: {
          status,
          mergeRequestId: opts?.mergeRequestId ?? null,
          updatedAt: now,
        },
      })
  }
}
