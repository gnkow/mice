import { decideSelfMerge, signerAuthorKey } from './selfMerge.js'
import type { MergeRequestRecord } from './mergeRequestStore.js'
import type { SignatureBinding } from '../../authentication/signing.js'

export const SIGNED_MERGE_REFUSALS = {
  not_open: 'not_open',
  not_approver: 'not_approver',
  self_merge: 'self_merge',
  head_mismatch: 'head_mismatch',
  binding_mismatch: 'binding_mismatch',
  meaning: 'meaning',
  change_control: 'change_control',
  not_validated: 'not_validated',
  restore_test_required: 'restore_test_required',
} as const

export type SignedMergeRefusalCode =
  (typeof SIGNED_MERGE_REFUSALS)[keyof typeof SIGNED_MERGE_REFUSALS]

export type SignedMergeDecision =
  | { ok: true }
  | { ok: false; code: SignedMergeRefusalCode; detail: string }

/**
 * Pure gate for completing a signed merge into a validated branch (GxP ticket 05).
 * HTTP adapters load approver/MR/signature/manifest and call this once.
 */
export function decideSignedMergeComplete(input: {
  mr: Pick<
    MergeRequestRecord,
    | 'status'
    | 'expectedSourceHead'
    | 'expectedTargetHead'
    | 'targetBranch'
    | 'openedBy'
  >
  isApprover: boolean
  isValidatedTarget: boolean
  liveSourceHead: string
  liveTargetHead: string
  authors: readonly string[]
  signer: { iss: string; sub: string }
  signature: {
    meaning: string
    binding?: SignatureBinding
    changeControlId?: string
  }
  expectedManifestDigest: string
}): SignedMergeDecision {
  if (input.mr.status !== 'open') {
    return { ok: false, code: SIGNED_MERGE_REFUSALS.not_open, detail: 'Merge request is not open' }
  }
  if (!input.isValidatedTarget) {
    return {
      ok: false,
      code: SIGNED_MERGE_REFUSALS.not_validated,
      detail: 'Target branch is not validated; use the unsigned merge path',
    }
  }
  if (!input.isApprover) {
    return {
      ok: false,
      code: SIGNED_MERGE_REFUSALS.not_approver,
      detail: 'Approver role required',
    }
  }
  // ADR 0009: authorship self-Valid is enforced via the disposition map, not a
  // blanket author ban. Still refuse when the requester tries to complete their own MR.
  const self = decideSelfMerge(input.signer, [], input.mr.openedBy)
  if (!self.allow) {
    return { ok: false, code: SIGNED_MERGE_REFUSALS.self_merge, detail: self.reason }
  }
  if (
    input.liveSourceHead !== input.mr.expectedSourceHead ||
    input.liveTargetHead !== input.mr.expectedTargetHead
  ) {
    return {
      ok: false,
      code: SIGNED_MERGE_REFUSALS.head_mismatch,
      detail: 'Source or target head moved; resync the merge request',
    }
  }
  if (input.signature.meaning !== 'Approved') {
    return {
      ok: false,
      code: SIGNED_MERGE_REFUSALS.meaning,
      detail: 'Signature meaning must be Approved',
    }
  }
  if (!input.signature.changeControlId?.trim()) {
    return {
      ok: false,
      code: SIGNED_MERGE_REFUSALS.change_control,
      detail: 'Change-control id required on merge signatures',
    }
  }
  const b = input.signature.binding
  if (
    !b ||
    b.sourceHead !== input.liveSourceHead ||
    b.targetHead !== input.liveTargetHead ||
    b.manifestDigest !== input.expectedManifestDigest
  ) {
    return {
      ok: false,
      code: SIGNED_MERGE_REFUSALS.binding_mismatch,
      detail: 'Signature binding does not match merge heads and manifest digest',
    }
  }
  return { ok: true }
}

/**
 * True when `branch` is in the repository's validated set.
 * The default branch is seeded at create; other branches join via Owner mark (#116).
 * Signed unmark (#119) removes names from that set (including the default).
 */
export function isValidatedBranch(
  branch: string,
  validatedBranches: readonly string[],
): boolean {
  const name = branch.trim()
  if (!name) return false
  return validatedBranches.some((b) => b.trim() === name)
}

export { signerAuthorKey }
