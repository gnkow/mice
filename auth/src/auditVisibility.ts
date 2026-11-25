import { eq } from 'drizzle-orm'
import { knownAuditActions } from './auditLabels.js'
import { getDb } from './db/database.js'
import { auditVisibility } from './db/schema.js'

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
 * Criterion: not needed for a typical GxP data/change investigation.
 * Still written to the ledger; Security/admin can unhide any of these.
 */
export const DEFAULT_AUDITOR_HIDDEN_ACTIONS: readonly string[] = [
  // Routine auth / session noise
  'auth.login',
  'auth.login.failed',
  'auth.reauth',
  'auth.reauth.failed',
  'auth.logout',
  'token.refresh',
  'token.create',
  'device.approve',
  'device.deny',
  'device.redeem',
  // Desktop session lifecycle (ops noise; mounts/force-release stay visible)
  'session.create',
  'session.ready',
  'session.fail',
  'session.connect',
  'session.disconnect',
  'session.stop',
  'session.retry',
  'session.remount',
  'session.destroy',
  'session.sync',
  'session.mounts.update',
  'session.evict',
  // Lease chatter (force_release stays visible — security-relevant)
  'workspace.lease.acquire',
  'workspace.lease.release',
  // Infra / store maintenance
  'checkout.build',
  'checkout.evict',
  'checkout.corrupt',
  'store.gc',
  'store.scrub',
  'store.full',
  'workspace.retry',
  'job.sync',
  // Audit-of-audit volume (export / break / visibility stay visible)
  'audit.browse',
  'acl_bypass_read',
  // Read-only dataset probes
  'versions.query',
  // Instance UX / diagnostics
  'announcement.create',
  'announcement.update',
  'announcement.delete',
  'instance.group_binding.check',
  'directory.sync.failed',
  'directory.sync.stale',
  // Push transport chunks (complete/publish stays visible)
  'commit.upload',
  // Rejected bad requests (denials that matter for access stay via access/role events)
  'request.rejected',
  'request.cross_site_rejected',
]

const knownValues = () => new Set(knownAuditActions().map((a) => a.value))

/** Product default hidden set, filtered to the current catalogue. */
export function defaultAuditorHiddenActions(): string[] {
  const known = knownValues()
  return DEFAULT_AUDITOR_HIDDEN_ACTIONS.filter((a) => known.has(a)).sort()
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
