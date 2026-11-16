import { decideIsApprover } from './authzApproverStore.js'
import { signatureStore } from './authentication/signing/signatureStore.js'
import { buildMergeManifest, mergeResultBinding } from './authentication/signing/mergeManifest.js'
import {
  getMergeRequest,
  markMergeRequestMerged,
  type MergeRequestRecord,
} from './mergeRequestStore.js'
import { markCommitsQc } from './commitQcStore.js'
import {
  decideSignedMergeComplete,
  isValidatedBranch,
  SIGNED_MERGE_REFUSALS,
  type SignedMergeRefusalCode,
} from './signedMergeComplete.js'
import { anyCommitQcFailed } from './signatureRevoke.js'
import { decideRestoreTestGate } from './restoreTestGate.js'

export type CompleteSignedMergeInput = {
  mergeRequestId: string
  signer: { iss: string; sub: string; name?: string }
  signatureId: string
  liveSourceHead: string
  liveTargetHead: string
  /** Commit authors in the merged range (`iss|sub`). */
  authors: string[]
  /** Commits to mark QC Passed (range + merge commit after success). */
  commitIds: string[]
  /** Optional precomputed merge-result file digests (tests); otherwise empty tree. */
  manifestEntries?: Array<{ path: string; contentHash: string }>
  /** Perform the oxen merge; returns the merge commit id. */
  executeMerge: (mr: MergeRequestRecord) => Promise<{ mergeCommitId: string }>
}

export type CompleteSignedMergeResult =
  | {
      ok: true
      mergeRequest: MergeRequestRecord
      signatureId: string
      mergeCommitId: string
    }
  | { ok: false; status: number; code: SignedMergeRefusalCode | 'signature_invalid'; detail: string }

/**
 * Orchestrate gxp/05: gate → consume bound signature → oxen merge → MR merged + QC Passed.
 */
export async function completeSignedMerge(
  input: CompleteSignedMergeInput,
): Promise<CompleteSignedMergeResult> {
  const mr = await getMergeRequest(input.mergeRequestId)
  if (!mr) {
    return {
      ok: false,
      status: 404,
      code: SIGNED_MERGE_REFUSALS.not_open,
      detail: 'Merge request not found',
    }
  }

  const approver = await decideIsApprover(input.signer, mr.namespace, mr.repo)
  const merge = buildMergeManifest(input.manifestEntries ?? [])
  const { binding } = mergeResultBinding({
    repo: `${mr.namespace}/${mr.repo}`,
    sourceHead: input.liveSourceHead,
    targetHead: input.liveTargetHead,
    merge,
  })

  const store = await signatureStore()
  const found = await store.get(input.signatureId)
  if (!found) {
    return {
      ok: false,
      status: 400,
      code: 'signature_invalid',
      detail: 'Unknown signature id',
    }
  }
  if (await store.isConsumed(input.signatureId)) {
    return {
      ok: false,
      status: 400,
      code: 'signature_invalid',
      detail: 'This signature has already been used',
    }
  }

  const restore = decideRestoreTestGate()
  if (!restore.allow) {
    return {
      ok: false,
      status: 503,
      code: SIGNED_MERGE_REFUSALS.restore_test_required,
      detail: restore.detail ?? 'Restore test required',
    }
  }

  if (await anyCommitQcFailed(mr.repositoryId, input.commitIds)) {
    return {
      ok: false,
      status: 409,
      code: SIGNED_MERGE_REFUSALS.not_open,
      detail: 'Merge blocked: one or more commits are QC Failed',
    }
  }

  const decision = decideSignedMergeComplete({
    mr,
    isApprover: approver.allow,
    isValidatedTarget: isValidatedBranch(mr.targetBranch),
    liveSourceHead: input.liveSourceHead,
    liveTargetHead: input.liveTargetHead,
    authors: input.authors,
    signer: input.signer,
    signature: {
      meaning: found.record.meaning,
      binding: found.record.binding,
      changeControlId: found.record.changeControlId,
    },
    expectedManifestDigest: binding.manifestDigest,
  })
  if (!decision.ok) {
    const status =
      decision.code === SIGNED_MERGE_REFUSALS.head_mismatch
        ? 409
        : decision.code === SIGNED_MERGE_REFUSALS.not_approver ||
            decision.code === SIGNED_MERGE_REFUSALS.self_merge
          ? 403
          : 400
    return { ok: false, status, code: decision.code, detail: decision.detail }
  }

  // Ensure the stored signature binding matches what we just decided (heads + digest).
  const sb = found.record.binding
  if (
    !sb ||
    sb.sourceHead !== binding.sourceHead ||
    sb.targetHead !== binding.targetHead ||
    sb.manifestDigest !== binding.manifestDigest
  ) {
    return {
      ok: false,
      status: 400,
      code: SIGNED_MERGE_REFUSALS.binding_mismatch,
      detail: 'Signature binding does not match merge heads and manifest digest',
    }
  }

  await store.consume(input.signatureId)
  const { mergeCommitId } = await input.executeMerge(mr)
  const merged = await markMergeRequestMerged(mr.id, { mergeCommitId })
  const passed = [...new Set([...input.commitIds, mergeCommitId])]
  if (passed.length > 0) {
    await markCommitsQc(mr.repositoryId, passed, 'passed', {
      mergeRequestId: mr.id,
      allowFailedToPassed: true,
    })
  }
  return {
    ok: true,
    mergeRequest: merged,
    signatureId: input.signatureId,
    mergeCommitId,
  }
}
