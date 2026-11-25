/**
 * First-class audit change: what mutated on the resource.
 *
 * - Update: only keys that differ (missing key → null).
 * - Create: before null, after full content.
 * - Delete: before full content, after null.
 * - Non-mutation / Intent (not yet applied): {@link EMPTY_AUDIT_CHANGE}.
 */

export type AuditChangeValue = Record<string, unknown> | null

export type AuditChange = {
  before: AuditChangeValue
  after: AuditChangeValue
}

/** Non-mutating events and Intents (effect not applied yet). */
export const EMPTY_AUDIT_CHANGE: AuditChange = Object.freeze({
  before: null,
  after: null,
})

function stableEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null)
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * Build a field-level change. Callers pass full snapshots; only deltas are kept for updates.
 * Returns {@link EMPTY_AUDIT_CHANGE} when both sides are null or an update has no differing keys.
 */
export function auditChange(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChange {
  if (before === null && after === null) return EMPTY_AUDIT_CHANGE
  if (before === null) return { before: null, after: { ...after! } }
  if (after === null) return { before: { ...before }, after: null }

  const bOut: Record<string, unknown> = {}
  const aOut: Record<string, unknown> = {}
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const bv = Object.prototype.hasOwnProperty.call(before, k) ? before[k] : null
    const av = Object.prototype.hasOwnProperty.call(after, k) ? after[k] : null
    if (!stableEqual(bv, av)) {
      bOut[k] = bv ?? null
      aOut[k] = av ?? null
    }
  }
  if (Object.keys(bOut).length === 0 && Object.keys(aOut).length === 0) {
    return EMPTY_AUDIT_CHANGE
  }
  return { before: bOut, after: aOut }
}

/** True when there is nothing to record (non-mutation empty, or update no-op). */
export function isEmptyAuditChange(change: AuditChange): boolean {
  if (change.before === null && change.after === null) return true
  if (change.before === null || change.after === null) return false
  return Object.keys(change.before).length === 0 && Object.keys(change.after).length === 0
}

/** API refusal when a purported mutation would not change state. */
export class NoChangeError extends Error {
  readonly code = 'no_change' as const
  constructor(message = 'No change') {
    super(message)
    this.name = 'NoChangeError'
  }
}

/**
 * For mutation handlers: build the change or throw {@link NoChangeError} so the API refuses
 * and nothing is audited.
 */
export function requireAuditChange(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChange {
  const change = auditChange(before, after)
  if (isEmptyAuditChange(change)) throw new NoChangeError()
  return change
}

/** Fail-closed: before-state could not be loaded. */
export class AuditChangeCaptureError extends Error {
  readonly code = 'audit_change_unavailable' as const
  constructor(message = 'Could not capture state before mutation') {
    super(message)
    this.name = 'AuditChangeCaptureError'
  }
}
