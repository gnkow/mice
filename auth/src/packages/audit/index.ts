/**
 * Public entry point for the audit module.
 * Intentional surface: append / query / readiness / observer / schedule / types.
 * Niche helpers remain importable via root strangler shims (`auth/src/audit*.ts`).
 */

// --- types ---
export type {
  AuditActor,
  AuditChange,
  AuditEvent,
  AuditInput,
  AuditPhase,
  AuditQuery,
  AuditReadiness,
  AuditResource,
  AuditVerification,
  AuditVia,
  TrackedReason,
} from './lib/audit.js'
export { AuditStoreError } from './lib/audit.js'

// --- observer / schedule / readiness / verify ---
export {
  setAuditObserver,
  startAuditVerifySchedule,
  auditReadiness,
  composeAuditReadiness,
  verifyAudit,
  initAudit,
  auditChainBlocked,
  acknowledgeAuditBreak,
  useAuditLedger,
} from './lib/audit.js'

// --- append / intent-outcome ---
export {
  actorFromUser,
  appendAudit,
  appendIntent,
  appendOutcome,
  appendOutcomeFor,
  beginTrackedIntent,
  trackIntent,
  trackedIntent,
  assertIntentAction,
  IntentActionError,
  FORBIDDEN_INTENT_ACTIONS,
  EMPTY_AUDIT_CHANGE,
  requireAuditChange,
  auditChange,
  isEmptyAuditChange,
  NoChangeError,
  AuditChangeCaptureError,
  AUDIT_UNAVAILABLE_MESSAGE,
} from './lib/audit.js'

export { auditMutation } from './lib/auditMutation.js'
export { replayAuditQueryIndex, verifyAuditQueryIndex } from './lib/auditQueryIndex.js'
export { carryFromIntent, orphanIntents } from './lib/auditIntentOutcome.js'
export { intentReasonFields } from './lib/auditReasonFields.js'

// --- query / export ---
export {
  queryAudit,
  queryAuditForExport,
  readAuditAfter,
  readAuditAfterWithSeq,
  listAllAuditEvents,
  auditFacets,
  auditEventsToCsv,
  csvCell,
  buildAuditExportBundle,
  EXPORT_MAX_ROWS,
  AUDIT_CSV_COLUMNS,
  applyAuditQueryFilters,
  eventJobIds,
  eventSessionIds,
  eventWorkspaceIds,
  auditResourceUri,
} from './lib/audit.js'

// --- high-traffic fail-closed / reason / capture (composition + guards) ---
export {
  AUDIT_UNAVAILABLE_RETRY_AFTER_SEC,
  AUDIT_UNAVAILABLE_STATUS,
  auditUnavailableJson,
  auditUnavailablePayload,
  auditUnavailableResponse,
} from './lib/auditFailClosed.js'
export type { AuditUnavailablePayload } from './lib/auditFailClosed.js'

export {
  AuditDetailPolicyError,
  FORBIDDEN_DETAIL_KEYS,
  validateAuditDetail,
} from './lib/auditDetailPolicy.js'

export {
  createExemptActions,
  declareReason,
  declaredChangeControlId,
  isDatasetMutation,
  mutationNeedsReason,
  REASON_HEADER,
  reasonRequiredActions,
  resolveReason,
} from './lib/auditReason.js'
export type { ReasonRejection, ReasonSource, ResolvedReason } from './lib/auditReason.js'

export { captureBefore, pickSnapshot } from './lib/auditCapture.js'

export {
  AUDITOR_CANNOT_SIGN,
  AUDITOR_MFA_REASON,
  decideAclBypassRead,
  decideAuditorAdmission,
  decideAuditorCannotSign,
  decideAuditorMfa,
} from './lib/auditorAccess.js'


export { initAuditOutage } from './lib/auditOutage.js'
export {
  reportAuditDegradation,
  currentAuditOutage,
  listAuditOutages,
  immudbHaAttested,
  immudbHaStatus,
} from './lib/auditOutage.js'

export * from './lib/auditActor.js'

export * from './lib/auditAppend.js'

export * from './lib/auditChange.js'

export * from './lib/auditDataset.js'

export * from './lib/auditExport.js'

export * from './lib/auditIntentAction.js'

export * from './lib/auditLedger.js'

export * from './lib/auditQuery.js'

export * from './lib/auditSnapshot.js'

export * from './lib/auditTypes.js'

export * from './lib/auditVerify.js'
