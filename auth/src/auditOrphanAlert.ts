import { orphanIntents, type AuditEvent } from './audit.js'
import { env } from './env.js'

/** Default / configured aging threshold in milliseconds (`AUDIT_ORPHAN_ALERT_SEC`). */
export function orphanAgingThresholdMs(): number {
  return env.auditOrphanAlertSec * 1000
}

/** Unpaired Intents whose timestamp is older than `thresholdMs` at `now`. */
export function agedOrphanIntents(
  events: AuditEvent[],
  now: number,
  thresholdMs: number = orphanAgingThresholdMs(),
): AuditEvent[] {
  const cutoff = now - thresholdMs
  return orphanIntents(events).filter((e) => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t <= cutoff
  })
}

/** True when an unpaired Intent is past the aging threshold (visible in audit, not notified). */
export function isAgedOrphanIntent(
  event: Pick<AuditEvent, 'phase' | 'ts'>,
  now: number,
  thresholdMs: number = orphanAgingThresholdMs(),
): boolean {
  if (event.phase !== 'intent') return false
  const t = Date.parse(event.ts)
  return Number.isFinite(t) && t <= now - thresholdMs
}

/**
 * Sort key for audit lists: aged unpaired Intents first, then other unpaired Intents,
 * then the rest (stable within each band by original order). Paired Intents are not boosted.
 */
export function orphanVisibilityRank(
  event: Pick<AuditEvent, 'id' | 'phase' | 'ts'>,
  now: number,
  thresholdMs: number,
  unpairedIds: Set<string>,
): 0 | 1 | 2 {
  if (!unpairedIds.has(event.id)) return 2
  return isAgedOrphanIntent(event, now, thresholdMs) ? 0 : 1
}

/** Stable reorder: aged orphans → young unpaired Intents → everything else. */
export function prioritizeOrphanIntents<E extends Pick<AuditEvent, 'id' | 'phase' | 'ts' | 'intent_id'>>(
  events: E[],
  now: number,
  thresholdMs: number = orphanAgingThresholdMs(),
): E[] {
  const unpairedIds = new Set(orphanIntents(events).map((e) => e.id))
  return [...events]
    .map((e, index) => ({
      e,
      index,
      rank: orphanVisibilityRank(e, now, thresholdMs, unpairedIds),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.e)
}

/** Response annotation for list/export readers (not stored on the ledger). */
export function orphanListAnnotation(
  event: Pick<AuditEvent, 'phase' | 'ts'>,
  now: number,
  thresholdMs: number = orphanAgingThresholdMs(),
): { orphan: true; orphan_aged: boolean } | Record<string, never> {
  if (event.phase !== 'intent') return {}
  return {
    orphan: true,
    orphan_aged: isAgedOrphanIntent(event, now, thresholdMs),
  }
}
