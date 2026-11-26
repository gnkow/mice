/**
 * Facade for the audit write/read surface. Prefer importing from the focused
 * submodules (`auditAppend`, `auditQuery`, `auditVerify`, …) or the package
 * `index.ts` intentional surface.
 */
export type {
  AuditActor,
  AuditEvent,
  AuditInput,
  AuditPhase,
  AuditQuery,
  AuditResource,
  AuditVia,
} from './auditTypes.js'
export { AuditStoreError } from './auditTypes.js'

export type { AuditChange } from './auditChange.js'
export {
  EMPTY_AUDIT_CHANGE,
  auditChange,
  isEmptyAuditChange,
  requireAuditChange,
  NoChangeError,
  AuditChangeCaptureError,
} from './auditChange.js'

export type { AuditVerification } from './auditChainGate.js'
export type { AuditReadiness } from './auditReadiness.js'
export { composeAuditReadiness } from './auditReadiness.js'
export { AUDIT_UNAVAILABLE_MESSAGE } from './auditFailClosed.js'
export {
  eventJobIds,
  eventSessionIds,
  eventWorkspaceIds,
  applyAuditQueryFilters,
} from './auditQueryFilters.js'
export { intentReasonFields, type TrackedReason } from './auditReasonFields.js'
export {
  carryFromIntent,
  orphanIntents,
  type AuditIntentOutcome,
} from './auditIntentOutcome.js'
export { assertIntentAction, IntentActionError, FORBIDDEN_INTENT_ACTIONS } from './auditIntentAction.js'
export { auditResourceUri } from './auditResourceUri.js'

export { setAuditObserver } from './auditObserver.js'
export { useAuditLedger } from './auditLedgerHandle.js'
export {
  actorFromUser,
  extractMessageFromJson,
  extractMessageFromForm,
  extractRepoCreateFromJson,
} from './auditActor.js'
export {
  appendAudit,
  appendIntent,
  appendOutcome,
  trackIntent,
  beginTrackedIntent,
  appendOutcomeFor,
  trackedIntent,
} from './auditAppend.js'
export {
  auditChainBlocked,
  acknowledgeAuditBreak,
  verifyAudit,
  auditReadiness,
  initAudit,
} from './auditVerify.js'
export { startAuditVerifySchedule } from './auditSchedule.js'
export { buildAuditExportBundle } from './auditExportBundle.js'
export {
  readAuditAfter,
  readAuditAfterWithSeq,
  listAllAuditEvents,
  queryAudit,
  queryAuditForExport,
  auditFacets,
  EXPORT_MAX_ROWS,
  AUDIT_CSV_COLUMNS,
  csvCell,
  auditEventsToCsv,
} from './auditQuery.js'
