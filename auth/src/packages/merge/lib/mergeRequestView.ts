import { captureBefore } from '../../audit/change.js'
import { pickSnapshot } from '../../audit/change.js'
import { getMergeRequest, type MergeRequestRecord } from './mergeRequestStore.js'
import { reconcileMergeRequestAgainstLiveTips } from './mergeRequestTipSync.js'
import { liveTipsFor } from './mergeRequestOxen.js'
import { resolveSignatureForMergeRequest } from './signatureRevoke.js'

const MR_SNAPSHOT_KEYS = [
  'id',
  'repositoryId',
  'sourceBranch',
  'targetBranch',
  'expectedSourceHead',
  'expectedTargetHead',
  'status',
  'title',
  'description',
  'mergeCommitId',
] as const

/** Merge-request state for audit deltas (status transitions, pinned heads, merge commit). */
export function mrSnapshot(mr: MergeRequestRecord | null): Record<string, unknown> | null {
  return pickSnapshot(mr, MR_SNAPSHOT_KEYS)
}

export async function captureMrSnapshot(id: string): Promise<Record<string, unknown> | null> {
  return mrSnapshot(await captureBefore(() => getMergeRequest(id)))
}

export async function reconcileOne(mr: MergeRequestRecord): Promise<MergeRequestRecord> {
  if (mr.status !== 'open' && mr.status !== 'stale') return mr
  try {
    const tips = await liveTipsFor(mr)
    if (!tips) return mr
    return await reconcileMergeRequestAgainstLiveTips(mr, tips)
  } catch {
    return mr
  }
}

/** Public MR JSON plus optional signature ref for Approver revoke on Merged (#93). */
export async function publicMergeRequest(
  mr: MergeRequestRecord,
  revokedIds?: Set<string>,
) {
  if (mr.status !== 'merged') return mr
  const sig = await resolveSignatureForMergeRequest(mr, revokedIds)
  if (!sig) return mr
  return {
    ...mr,
    signatureId: sig.signatureId,
    signatureRevoked: sig.revoked,
  }
}
