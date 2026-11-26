import { eq } from 'drizzle-orm'
import { knownAuditActions } from './auditLabels.js'
import { defaultAuditorHiddenFromCatalog } from './auditTrailCatalog.js'
import { getDb } from '../../../db/database.js'
import { auditVisibility } from '../../../db/schema.js'

const ROW_ID = 'instance'

export type AuditVisibilityState = {
  /** Exact action names hidden from Auditor views (still written to the ledger). */
  hiddenActions: string[]
  updatedAt: string | null
  /** True when no admin override is stored — product defaults apply. */
  usingDefaults: boolean
}

export type AuditVisibilityAction = {
  value: string
  label: string
  group: string
  visible: boolean
}

/**
 * Actions hidden from Auditors until an admin overrides visibility.
 * Derived from {@link defaultAuditorHiddenFromCatalog} (#154 trail policy).
 * Still written to the ledger; Security/admin can unhide any of these.
 */
export const DEFAULT_AUDITOR_HIDDEN_ACTIONS: readonly string[] = defaultAuditorHiddenFromCatalog()

/**
 * Hide-set applied to Auditor queries: exactly the Settings hide-set. Nothing is force-hidden;
 * legacy `bff.mutation` rows stay visible (and labelled) so no ledger entry is suppressed.
 * New Intents never carry that action (see `auditIntentAction.ts`).
 */
export function auditorExcludeActions(hiddenFromSettings: readonly string[]): string[] {
  return [...new Set(hiddenFromSettings)].sort()
}

const knownValues = () => new Set(knownAuditActions().map((a) => a.value))

/** Product default hidden set, filtered to the current catalogue. */
export function defaultAuditorHiddenActions(): string[] {
  return defaultAuditorHiddenFromCatalog()
}

/** Normalize a caller-supplied hidden list to known catalogue actions only. */
export function normalizeHiddenActions(raw: unknown): string[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'hiddenActions must be an array of action names' }
  const known = knownValues()
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      return { error: 'hiddenActions entries must be non-empty strings' }
    }
    const value = item.trim()
    if (!known.has(value)) return { error: `Unknown audit action "${value}"` }
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out.sort()
}

function sameHiddenSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export async function getAuditVisibility(): Promise<AuditVisibilityState> {
  const defaults = defaultAuditorHiddenActions()
  const [row] = await getDb()
    .select()
    .from(auditVisibility)
    .where(eq(auditVisibility.id, ROW_ID))
    .limit(1)
  if (!row) {
    // Persist product defaults so Auditors and Settings share one source of truth.
    return setAuditVisibility(defaults)
  }
  const known = knownValues()
  const hidden = Array.isArray(row.hiddenActions)
    ? row.hiddenActions.filter((a): a is string => typeof a === 'string' && known.has(a)).sort()
    : []
  return {
    hiddenActions: hidden,
    updatedAt: row.updatedAt.toISOString(),
    usingDefaults: sameHiddenSet(hidden, defaults),
  }
}

export async function setAuditVisibility(hiddenActions: string[]): Promise<AuditVisibilityState> {
  const now = new Date()
  const normalized = [...hiddenActions].sort()
  await getDb()
    .insert(auditVisibility)
    .values({
      id: ROW_ID,
      hiddenActions: normalized,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: auditVisibility.id,
      set: { hiddenActions: normalized, updatedAt: now },
    })
  return {
    hiddenActions: normalized,
    updatedAt: now.toISOString(),
    usingDefaults: sameHiddenSet(normalized, defaultAuditorHiddenActions()),
  }
}

/** Restore the product default Auditor visibility policy. */
export async function resetAuditVisibilityToDefaults(): Promise<AuditVisibilityState> {
  return setAuditVisibility(defaultAuditorHiddenActions())
}

/** Catalogue with visibility flags for the admin UI. */
export async function listAuditVisibilityActions(): Promise<{
  actions: AuditVisibilityAction[]
  updatedAt: string | null
  usingDefaults: boolean
}> {
  const { hiddenActions, updatedAt, usingDefaults } = await getAuditVisibility()
  const hidden = new Set(hiddenActions)
  return {
    updatedAt,
    usingDefaults,
    actions: knownAuditActions().map((a) => ({
      ...a,
      visible: !hidden.has(a.value),
    })),
  }
}

/** True when this action should be omitted from Auditor list/export views. */
export function isHiddenFromAuditor(action: string, hiddenActions: readonly string[]): boolean {
  return hiddenActions.includes(action)
}
