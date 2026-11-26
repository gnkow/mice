import type { AuditChange } from './auditChange.js'
import type { AuditFocus } from './auditQueryFilters.js'

export type AuditVia = 'session' | 'pat'

export type AuditActor = {
  sub: string
  iss: string
  email: string
  name: string
}

/** `intent` is written before a mutation runs, `outcome` after. Other events carry no phase. */
export type AuditPhase = 'intent' | 'outcome'

export type AuditEvent = {
  id: string
  ts: string
  actor: AuditActor
  via: AuditVia | 'system'
  phase?: AuditPhase
  /** On an outcome event: the id of the intent event it completes. */
  intent_id?: string
  method: string
  path: string
  status: number
  action: string
  namespace?: string
  repo?: string
  /** Stable namespace UUID; `namespace` remains the name snapshot at event time. */
  namespace_id?: string
  /** Stable repository UUID; `repo` remains the name snapshot at event time. */
  repository_id?: string
  message?: string
  /** Why the change was made (mandatory for dataset and admin mutations); `message` stays the commit message. */
  reason?: string
  reason_source?: 'explicit' | 'commit-message'
  /** Pick-list category when a reason is required (GxP ticket 03). */
  category?: string
  /** QMS change-control id when required (GxP ticket 04). */
  change_control_id?: string
  /** Electronic signature id when required on regulated mutations (GxP ticket 27). */
  signature_id?: string
  /** Dataset commit ids before and after a dataset mutation. */
  dataset?: { base?: string; head?: string }
  /** The mutation succeeded but its resulting dataset version could not be determined. */
  unverified?: true
  detail?: Record<string, unknown>
  /** Optional accountable human when the actor is automation attributed to a person. */
  owner?: AuditActor
  /** Hashed IP (SHA-256(IP + daily_salt)) for anomaly detection while preserving privacy (U8). */
  hashed_ip?: string
  /**
   * Canonical primary resource (`type:id`, always set). Derived on write and filled on
   * read upcast for older ledger rows.
   */
  resource_uri: string
  /**
   * What changed: field deltas, or null→full / full→null for create/delete.
   * Non-mutations and Intents use `{ before: null, after: null }`.
   */
  change: AuditChange
  /** Event shape version; readers upcast older blobs (US11 / Q19). */
  schema_version: number
}

export type AuditQuery = {
  actor?: string
  namespace?: string
  repo?: string
  action?: string
  /** Investigation Focus preset (`signatures` | `files` | `merges` | `roles`). */
  focus?: AuditFocus
  since?: string
  until?: string
  limit?: number
  /** Exclusive: return events older than this id (reverse chronological). */
  cursor?: string
  sessionId?: string
  workspaceId?: string
  jobId?: string
  via?: AuditVia
  /** AuthZ scope: only events in these namespaces (applied before paging). */
  allowedNamespaces?: string[]
  /**
   * Lists show one row per mutation: an intent that has an outcome is hidden (the outcome carries
   * `intent_id`). An intent without an outcome stays visible, as it means the mutation may have
   * started and never completed. Set to see every intent.
   */
  includeChain?: boolean
  /** When true, only unpaired Intent rows (honest gaps — no Outcome). */
  orphansOnly?: boolean
  /** Exact action names to omit (Auditor visibility). Still present on the ledger. */
  excludeActions?: string[]
}

export type AuditResource = {
  id: string
  count: number
  lastTs: string
  namespace?: string
  repo?: string
  /** Human label when `id` is opaque (e.g. actor email → display name). */
  label?: string
}

export type AuditInput = Omit<
  AuditEvent,
  'id' | 'ts' | 'phase' | 'intent_id' | 'via' | 'schema_version' | 'resource_uri' | 'change'
> & {
  id?: string
  ts?: string
  via: AuditVia | 'system'
  schema_version?: number
  /** Defaults to empty (non-mutation / Intent). Mutations must pass a real delta. */
  change?: AuditChange
}

export class AuditStoreError extends Error {}
