import { decideIsApprover } from '../../authz/index.js'
import { signatureStore } from '../../authentication/signing.js'
import { buildMergeManifest, manifestForMergeResult, mergeResultBinding, ManifestEntry, MergeManifest } from '../../authentication/signing.js'
import {
  getMergeRequest,
  markMergeRequestMerged,
  markOpenMergeRequestsStaleForTip,
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
import { decideRestoreTestGate, loadRestoreTestStatus } from '../../platform/index.js'
import { authorsFromCommits, signerAuthorKey } from './selfMerge.js'
import { getBranchTip, listMergeCommits } from '../../jobs/index.js'

export type MergeRangeSnapshot = {
  authors: string[]
  commitIds: string[]
}

export type LiveHeadsSnapshot = {
  sourceHead: string
  targetHead: string
}

export type CompleteSignedMergeInput = {
  mergeRequestId: string
  /** Session identity; include IdP groups so group approver seats resolve. */
  signer: { iss: string; sub: string; name?: string; groups?: string[] }
  signatureId: string
  /**
   * Test-only override of the merge-result manifest. Production callers omit this so the
   * server computes the overlay of live source/target tip trees.
   */
  manifestEntries?: ManifestEntry[]
  /** Optional injector for merge-result resolution (tests); defaults to {@link manifestForMergeResult}. */
  resolveMergeManifest?: (input: {
    namespace: string
    repo: string
    sourceHead: string
    targetHead: string
  }) => Promise<MergeManifest>
  /**
   * Live branch tips. Production defaults to oxen; tests inject. Client body heads are never trusted.
   */
  resolveLiveHeads?: (mr: MergeRequestRecord) => Promise<LiveHeadsSnapshot>
  /**
   * Commits/authors in the merge range. Production defaults to oxen GET merge preview.
   */
  resolveMergeRange?: (input: {
    mr: MergeRequestRecord
    sourceHead: string
    targetHead: string
  }) => Promise<MergeRangeSnapshot>
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
  | {
      ok: false
      status: number
      code:
        | SignedMergeRefusalCode
        | 'signature_invalid'
        | 'manifest_unavailable'
        | 'merge_failed'
      detail: string
      /** Present when the signature was consumed before a later failure. */
      signatureConsumed?: boolean
      authors?: string[]
    }

async function defaultResolveLiveHeads(mr: MergeRequestRecord): Promise<LiveHeadsSnapshot> {
  const [sourceHead, targetHead] = await Promise.all([
    getBranchTip(mr.namespace, mr.repo, mr.sourceBranch),
    getBranchTip(mr.namespace, mr.repo, mr.targetBranch),
  ])
  if (!sourceHead || !targetHead) {
    throw new Error(
      `Could not resolve live tips for ${mr.sourceBranch}/${mr.targetBranch}`,
    )
  }
  return { sourceHead, targetHead }
}

async function defaultResolveMergeRange(input: {
  mr: MergeRequestRecord
  sourceHead: string
  targetHead: string
}): Promise<MergeRangeSnapshot> {
  const commits = await listMergeCommits(
    input.mr.namespace,
    input.mr.repo,
    input.mr.targetBranch,
    input.mr.sourceBranch,
  )
  return {
    authors: authorsFromCommits(commits),
    commitIds: commits.map((c) => c.id),
  }
}

/**
 * Orchestrate gxp/05: gate → consume bound signature → oxen merge → MR merged + QC Passed.
 * Authors, commit ids and live heads are always server-derived (injectable in tests).
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

  let live: LiveHeadsSnapshot
  try {
    live = await (input.resolveLiveHeads ?? defaultResolveLiveHeads)(mr)
  } catch (err) {
    return {
      ok: false,
      status: 503,
      code: 'manifest_unavailable',
      detail: `Live branch tips unavailable: ${String((err as Error)?.message ?? err)}`,
    }
  }

  let range: MergeRangeSnapshot
  try {
    range = await (input.resolveMergeRange ?? defaultResolveMergeRange)({
      mr,
      sourceHead: live.sourceHead,
      targetHead: live.targetHead,
    })
  } catch (err) {
    return {
      ok: false,
      status: 503,
      code: 'manifest_unavailable',
      detail: `Merge range unavailable: ${String((err as Error)?.message ?? err)}`,
    }
  }

  const approver = await decideIsApprover(input.signer, mr.namespace, mr.repo)
  let merge: MergeManifest
  try {
    merge = input.manifestEntries
      ? buildMergeManifest(input.manifestEntries)
      : await (input.resolveMergeManifest ??
          ((heads) =>
            manifestForMergeResult(
              { namespace: heads.namespace, repo: heads.repo },
              heads.sourceHead,
              heads.targetHead,
            )))({
          namespace: mr.namespace,
          repo: mr.repo,
          sourceHead: live.sourceHead,
          targetHead: live.targetHead,
        })
  } catch (err) {
    return {
      ok: false,
      status: 503,
      code: 'manifest_unavailable',
      detail: `Merge-result manifest unavailable: ${String((err as Error)?.message ?? err)}`,
    }
  }
  const { binding } = mergeResultBinding({
    repo: `${mr.namespace}/${mr.repo}`,
    sourceHead: live.sourceHead,
    targetHead: live.targetHead,
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
  if (
    signerAuthorKey(found.record.signer) !== signerAuthorKey(input.signer)
  ) {
    return {
      ok: false,
      status: 400,
      code: 'signature_invalid',
      detail: 'Signature was not created by the current signer',
    }
  }

  const restore = decideRestoreTestGate(await loadRestoreTestStatus())
  if (!restore.allow) {
    return {
      ok: false,
      status: 503,
      code: SIGNED_MERGE_REFUSALS.restore_test_required,
      detail: restore.detail ?? 'Restore test required',
    }
  }

  if (await anyCommitQcFailed(mr.repositoryId, range.commitIds)) {
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
    liveSourceHead: live.sourceHead,
    liveTargetHead: live.targetHead,
    authors: range.authors,
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
    return {
      ok: false,
      status,
      code: decision.code,
      detail: decision.detail,
      ...(decision.code === SIGNED_MERGE_REFUSALS.self_merge
        ? { authors: [...range.authors] }
        : {}),
    }
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

  // Consume before merge so the same signature cannot race two merges. If oxen
  // fails afterward the signature stays burned — surface that explicitly.
  await store.consume(input.signatureId)
  let mergeCommitId: string
  try {
    ;({ mergeCommitId } = await input.executeMerge(mr))
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: 'merge_failed',
      signatureConsumed: true,
      detail: `Merge failed after signature was consumed: ${String((err as Error)?.message ?? err)}`,
    }
  }
  const merged = await markMergeRequestMerged(mr.id, { mergeCommitId })
  const passed = [...new Set([...range.commitIds, mergeCommitId])]
  if (passed.length > 0) {
    await markCommitsQc(mr.repositoryId, passed, 'passed', {
      mergeRequestId: mr.id,
      allowFailedToPassed: true,
    })
  }
  // Other open MRs into this target are now stale (tips moved).
  await markOpenMergeRequestsStaleForTip({
    repositoryId: mr.repositoryId,
    branch: mr.targetBranch,
    newTip: mergeCommitId,
  })
  return {
    ok: true,
    mergeRequest: merged,
    signatureId: input.signatureId,
    mergeCommitId,
  }
}
