import type { AuditEvent } from './audit.js'

/** Current on-write schema version for audit events. */
export const CURRENT_AUDIT_SCHEMA_VERSION = 1

/**
 * Historic action names → current canonical name (aliases only; never rename stored values).
 * Query filters that use the canonical name also match aliases.
 */
export const AUDIT_ACTION_ALIASES: Record<string, string> = {
  // Pre-Stage rename examples kept for readers of old trails
  'stage.commit': 'workspace.commit',
  'stage.merge': 'workspace.merge',
}

/** Canonical action for filtering (resolves aliases). */
export function canonicalAuditAction(action: string): string {
  return AUDIT_ACTION_ALIASES[action] ?? action
}

/** True when stored action matches a filter value (exact, prefix, or via alias). */
export function auditActionMatches(stored: string, filter: string): boolean {
  if (stored === filter || stored.startsWith(`${filter}.`)) return true
  const canonical = canonicalAuditAction(stored)
  if (canonical === filter || canonical.startsWith(`${filter}.`)) return true
  // Filter was an old alias
  if (AUDIT_ACTION_ALIASES[filter] === stored || AUDIT_ACTION_ALIASES[filter] === canonical) return true
  return false
}

type RawEvent = Partial<AuditEvent> & { schema_version?: number }

/**
 * Bring a ledger JSON blob to the current reader shape.
 * Missing schema_version is treated as version 0 (pre-versioned events).
 */
export function upcastAuditEvent(raw: unknown): AuditEvent {
  const e = (raw && typeof raw === 'object' ? raw : {}) as RawEvent
  const version = typeof e.schema_version === 'number' ? e.schema_version : 0
  let event: AuditEvent = {
    id: typeof e.id === 'string' ? e.id : '',
    ts: typeof e.ts === 'string' ? e.ts : new Date(0).toISOString(),
    actor: e.actor ?? { sub: '', iss: '', email: '', name: '' },
    via: e.via ?? 'session',
    method: typeof e.method === 'string' ? e.method : '',
    path: typeof e.path === 'string' ? e.path : '',
    status: typeof e.status === 'number' ? e.status : 0,
    action: typeof e.action === 'string' ? e.action : 'other',
    schema_version: CURRENT_AUDIT_SCHEMA_VERSION,
    ...(e.phase ? { phase: e.phase } : {}),
    ...(e.intent_id ? { intent_id: e.intent_id } : {}),
    ...(e.namespace ? { namespace: e.namespace } : {}),
    ...(e.repo ? { repo: e.repo } : {}),
    ...(e.namespace_id ? { namespace_id: e.namespace_id } : {}),
    ...(e.repository_id ? { repository_id: e.repository_id } : {}),
    ...(e.message ? { message: e.message } : {}),
    ...(e.reason ? { reason: e.reason } : {}),
    ...(e.reason_source ? { reason_source: e.reason_source } : {}),
    ...(e.category ? { category: e.category } : {}),
    ...(e.change_control_id ? { change_control_id: e.change_control_id } : {}),
    ...(e.signature_id ? { signature_id: e.signature_id } : {}),
    ...(e.dataset ? { dataset: e.dataset } : {}),
    ...(e.unverified ? { unverified: true as const } : {}),
    ...(e.detail ? { detail: e.detail } : {}),
    ...(e.owner ? { owner: e.owner } : {}),
    ...(e.hashed_ip ? { hashed_ip: e.hashed_ip } : {}),
  }

  // v0 → v1: ensure schema_version stamped; action aliases remain as stored (readers use auditActionMatches).
  if (version < 1) {
    event = { ...event, schema_version: CURRENT_AUDIT_SCHEMA_VERSION }
  }
  return event
}
