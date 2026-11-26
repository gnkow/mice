/** Public entry point for the merge module. */
export {
  CHANGE_CONTROL_HEADER,
  CHANGE_CONTROL_ID_PATTERN,
  mutationNeedsChangeControl,
  allocateChangeControlId,
  normalizeChangeControlId,
  isValidChangeControlId,
  DuplicateChangeControlIdError,
  claimChangeControlId,
  resolveChangeControl,
} from './lib/changeControl.js'
export {
  DEFAULT_EMPTY_TIP_MESSAGE,
  normalizeEmptyTipMessage,
  recordCommitAttribution,
  getCommitAttributions,
  rewriteCommitAuthorsInOxenJson,
  getCommitAttribution,
} from './lib/commitAttributionStore.js'
export type {
  CommitAttribution,
} from './lib/commitAttributionStore.js'
export {
  getCommitQc,
  listCommitQcForRepo,
  markCommitsQc,
  unmarkCommitsForMergeRequest,
} from './lib/commitQcStore.js'
export type {
  CommitQc,
  CommitQcRow,
} from './lib/commitQcStore.js'
export { assertPinAllowed, PinRefusedError } from './lib/commitQcPin.js'
export {
  completeSignedMerge,
} from './lib/completeSignedMerge.js'
export type {
  MergeRangeSnapshot,
  LiveHeadsSnapshot,
  CompleteSignedMergeInput,
  CompleteSignedMergeResult,
} from './lib/completeSignedMerge.js'
export {
  setMergeExecutorForTests,
  setMergeManifestResolverForTests,
  setMergeRangeResolverForTests,
  setLiveHeadsResolverForTests,
} from './lib/mergeRequestOxen.js'
export {
  MergeRequestAlreadyOpenError,
  defaultMergeRequestTitle,
  openMergeRequest,
  getMergeRequest,
  listMergeRequests,
  decideMergeRequestComplete,
  markMergeRequestMerged,
  rejectMergeRequest,
  cancelMergeRequest,
  reopenMergeRequest,
} from './lib/mergeRequestStore.js'
export type {
  MergeRequestStatus,
  MergeRequestRecord,
} from './lib/mergeRequestStore.js'
export {
  markOpenMergeRequestsStaleForTip,
  markOpenMergeRequestsStaleForPublishedCommit,
  reconcileMergeRequestAgainstLiveTips,
  resyncMergeRequest,
} from './lib/mergeRequestTipSync.js'
export {
  SIGNATURE_HEADER,
  SIGNATURE_MAX_AGE_MS,
  mutationActionForPath,
  stableJson,
  normalizeMutationPath,
  canonicalMutationContent,
  mutationContentHash,
  prepareMutationDocument,
  mutationBodyFromProxyPayload,
  evaluateMutationSignatureBinding,
  resolveMutationSignature,
} from './lib/mutationSignature.js'
export type {
  MutationSignatureRejection,
  CanonicalMutation,
} from './lib/mutationSignature.js'
export {
  SELF_MERGE_FORBIDDEN,
  SELF_MERGE_REQUESTER_FORBIDDEN,
  signerAuthorKey,
  normalizePrincipalAuthorKey,
  decideSelfMerge,
  authorsFromCommits,
  evaluateSelfMergeFromCommits,
  selfMergeAuditDetail,
} from './lib/selfMerge.js'
export type {
  SelfMergeDecision,
} from './lib/selfMerge.js'
export {
  revokeSignature,
  revertSignatureRevocation,
  anyCommitQcFailed,
  resolveSignatureForMergeRequest,
  resolveSignatureCoveringCommit,
} from './lib/signatureRevoke.js'
export type {
  SignatureRevocation,
  RevokeSignatureInput,
  RevokeSignatureResult,
  SignatureRevocationRevert,
  RevertSignatureRevocationInput,
  RevertSignatureRevocationResult,
  ResolvedSignatureRef,
} from './lib/signatureRevoke.js'
export {
  SIGNED_MERGE_REFUSALS,
  decideSignedMergeComplete,
  isValidatedBranch,
} from './lib/signedMergeComplete.js'
export type {
  SignedMergeRefusalCode,
  SignedMergeDecision,
} from './lib/signedMergeComplete.js'
export {
  buildSignedRecordReport,
  signedRecordToPdfLines,
} from './lib/signedRecordReport.js'
export type {
  SignedRecordRow,
  SignedRecordReport,
} from './lib/signedRecordReport.js'
export {
  VALIDATED_BRANCH_DIRECT_WRITE,
  isTipChangingAction,
  resolveValidatedBranchSet,
  decideValidatedBranchWrite,
  branchTargetFromPath,
  branchFromMutationBody,
  branchesMovedByPublish,
  decideUnsignedTemplateSeed,
} from './lib/validatedBranchWrite.js'
export type {
  ValidatedBranchWriteDecision,
} from './lib/validatedBranchWrite.js'
export {
  listValidatedBranches,
  listValidatedBranchRows,
  ensureDefaultBranchValidated,
  markBranchValidated,
  unmarkBranchValidated,
} from './lib/validatedBranchStore.js'
export type {
  ValidatedBranchRow,
} from './lib/validatedBranchStore.js'
export {
  MICE_DEFAULT_BRANCH,
  resolveTipGateBranches,
  decideProxiedValidatedBranchWrite,
} from './lib/validatedBranchGate.js'
export {
  markBranchValidatedUseCase,
  listValidatedBranchesUseCase,
} from './lib/validatedBranchMark.js'

export * from './lib/mergeSignatures.js'
