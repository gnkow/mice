import type { Context } from 'hono'
import type { AuditChange } from '../../audit/change.js'
import type { AuditVia } from '../../audit/index.js'
import type { SessionUser } from '../../authentication/principal.js'

export type AuditFields = {
  action: string
  /**
   * What changed. Mutations must pass a real delta (create/delete/update).
   * Omit or pass empty for non-mutations / refusals.
   */
  change?: AuditChange
  message?: string
  namespace?: string
  repo?: string
  detail?: Record<string, unknown>
  status?: number
  /** Electronic signature id when this Outcome consumed a ceremony result. */
  signature_id?: string
  /** Free-text justification (first-class; shown in Audit Reason column). */
  reason?: string
  reason_source?: 'explicit' | 'commit-message'
  /** Change-control id (first-class; shown in Audit Change control column). */
  change_control_id?: string
  /** Hashed client IP when the mutation records network context. */
  hashed_ip?: string
}

/** Appends an audit event for a BFF-native mutation; injected so route modules need no whole-app setup. */
export type AuditFn = (
  c: Context,
  user: Pick<SessionUser, 'sub' | 'iss' | 'email' | 'name'>,
  via: AuditVia,
  fields: AuditFields,
) => Promise<void>

export type AuditDep = { audit: AuditFn }
