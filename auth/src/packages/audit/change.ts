/** Audit change helpers (no outage/notify/authz). */
export {
  EMPTY_AUDIT_CHANGE,
  requireAuditChange,
  auditChange,
  isEmptyAuditChange,
  NoChangeError,
  AuditChangeCaptureError,
} from './lib/auditChange.js'
export type { AuditChange } from './lib/auditChange.js'
export { captureBefore, pickSnapshot } from './lib/auditCapture.js'
