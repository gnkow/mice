import { and, eq, isNull } from 'drizzle-orm'
import { instancePermissions } from '../../authzInstanceStore.js'
import { membershipRefs } from '../../authzRepository.js'
import { currentClock } from '../../clock.js'
import { getDb } from '../../db/database.js'
import { principalDisabledPeriods, principals } from '../../db/schema.js'
import { isSuspended } from './miceSuspension.js'
import { lookupKeycloakUserStatus } from '../directory/directory.js'
import { canonicalIssuer, principalKey, type PrincipalId } from '../session/principal.js'
import { ensurePrincipal, type SessionUser } from '../session/session.js'

/** Automatic restore is allowed only through this long a disable. */
export const REENABLE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export type ReenablePeriod = {
  principal: string
  disabledAt: string
  awaitingConfirmation: boolean
}

type PrincipalRow = { id: number; iss: string; sub: string }

type OpenPeriod = { id: number; disabledAt: Date }

type RestorationDecision =
  | { kind: 'no-open-period' }
  | { kind: 'awaiting-confirmation'; period: OpenPeriod; disabledDurationMs: number }
  | { kind: 'blocked-by-mice'; period: OpenPeriod; disabledDurationMs: number }
  | { kind: 'automatic'; period: OpenPeriod; disabledDurationMs: number }
  | { kind: 'admin-eligible'; period: OpenPeriod; disabledDurationMs: number }
  | { kind: 'not-due' }

async function principalRow(principal: PrincipalId): Promise<PrincipalRow | null> {
  const [row] = await getDb()
    .select({ id: principals.id, iss: principals.iss, sub: principals.sub })
    .from(principals)
    .where(and(eq(principals.iss, canonicalIssuer(principal.iss)), eq(principals.sub, principal.sub)))
    .limit(1)
  return row ?? null
}

async function loadOpenPeriod(principalId: number): Promise<OpenPeriod | null> {
  const [open] = await getDb()
    .select({ id: principalDisabledPeriods.id, disabledAt: principalDisabledPeriods.disabledAt })
    .from(principalDisabledPeriods)
    .where(and(eq(principalDisabledPeriods.principalId, principalId), isNull(principalDisabledPeriods.reEnabledAt)))
    .limit(1)
  return open ?? null
}

/**
 * Deep decision for an open disable: window elapsed?, Mice flag?, IdP enabled?
 * Callers only learn the kind — close/audit stay on the public restore paths.
 */
async function decideRestoration(
  principal: PrincipalId,
  options: { requireIdpEnabled?: boolean } = {},
): Promise<RestorationDecision> {
  const row = await principalRow(principal)
  if (!row) return { kind: 'no-open-period' }
  const period = await loadOpenPeriod(row.id)
  if (!period) return { kind: 'no-open-period' }

  const disabledDurationMs = currentClock.now() - period.disabledAt.getTime()
  if (disabledDurationMs > REENABLE_WINDOW_MS) {
    if (options.requireIdpEnabled) {
      if (await lookupKeycloakUserStatus(row.sub) !== 'enabled') return { kind: 'not-due' }
      return { kind: 'admin-eligible', period, disabledDurationMs }
    }
    return { kind: 'awaiting-confirmation', period, disabledDurationMs }
  }
  if (await isSuspended(principal)) {
    return { kind: 'blocked-by-mice', period, disabledDurationMs }
  }
  return { kind: 'automatic', period, disabledDurationMs }
}

async function remainingGrants(user: { iss: string; sub: string; groups?: string[] }) {
  const grants = await instancePermissions(user)
  const memberships = (await membershipRefs({ key: principalKey(user), groups: user.groups ?? [] }))
    .map((membership) => `${membership.namespace}:${membership.role}`)
  return { grants, memberships }
}

async function closePeriod(
  periodId: number,
  fields: {
    reEnabledAt: Date
    restorationType: 'automatic' | 'admin-confirmed'
    auditEventId?: string | null
    confirmedBy?: string | null
  },
): Promise<void> {
  await getDb()
    .update(principalDisabledPeriods)
    .set(fields)
    .where(eq(principalDisabledPeriods.id, periodId))
}

async function markPendingConfirmation(periodId: number): Promise<void> {
  await getDb()
    .update(principalDisabledPeriods)
    .set({ restorationType: 'pending' })
    .where(eq(principalDisabledPeriods.id, periodId))
}

/** Records the first time this Principal is seen IdP-disabled. A later detection keeps the original time. */
export async function recordIdpDisabled(principal: PrincipalId & { name?: string; email?: string }): Promise<void> {
  await ensurePrincipal(principal)
  const row = await principalRow(principal)
  if (!row) return
  if (await loadOpenPeriod(row.id)) return
  await getDb().insert(principalDisabledPeriods).values({
    principalId: row.id,
    disabledAt: new Date(currentClock.now()),
  })
}

/** Open disabled periods. Confirmation is due only after the IdP enables the user past the window. */
export async function listReenablePeriods(): Promise<ReenablePeriod[]> {
  const rows = await getDb()
    .select({
      iss: principals.iss,
      sub: principals.sub,
      disabledAt: principalDisabledPeriods.disabledAt,
    })
    .from(principalDisabledPeriods)
    .innerJoin(principals, eq(principals.id, principalDisabledPeriods.principalId))
    .where(isNull(principalDisabledPeriods.reEnabledAt))
  const periods: ReenablePeriod[] = []
  for (const row of rows) {
    // Same decision table as confirm: past window + IdP enabled → awaiting admin.
    const decision = await decideRestoration(
      { iss: row.iss, sub: row.sub },
      { requireIdpEnabled: true },
    )
    periods.push({
      principal: `${row.iss}|${row.sub}`,
      disabledAt: row.disabledAt.toISOString(),
      awaitingConfirmation: decision.kind === 'admin-eligible',
    })
  }
  periods.sort((a, b) => a.principal.localeCompare(b.principal))
  return periods
}

export type RestorationAudit = {
  message: string
  detail: {
    principal: string
    disabledDurationMs: number
    restoration: 'automatic' | 'admin-confirmed'
    grants: string[]
    memberships: string[]
    confirmedBy?: string
  }
}

/** Closes an open disable that is still inside the window. A longer one stays blocked for an admin. */
export async function considerReenable(
  user: SessionUser,
  audit: (event: RestorationAudit) => Promise<string | null>,
): Promise<'allow' | 'awaiting-confirmation'> {
  const decision = await decideRestoration(user)
  if (decision.kind === 'no-open-period' || decision.kind === 'blocked-by-mice') return 'allow'
  if (decision.kind === 'awaiting-confirmation') {
    await markPendingConfirmation(decision.period.id)
    return 'awaiting-confirmation'
  }
  if (decision.kind !== 'automatic') return 'allow'

  const row = await principalRow(user)
  if (!row) return 'allow'
  const principal = `${row.iss}|${row.sub}`
  const { grants, memberships } = await remainingGrants(user)
  const auditEventId = await audit({
    message: `Restored ${principal}`,
    detail: {
      principal,
      disabledDurationMs: decision.disabledDurationMs,
      restoration: 'automatic',
      grants,
      memberships,
    },
  })
  await closePeriod(decision.period.id, {
    reEnabledAt: new Date(currentClock.now()),
    restorationType: 'automatic',
    auditEventId,
  })
  return 'allow'
}

/** Closes a long disable after an admin confirms it. Returns the audit payload, or null when confirmation is not due. */
export async function confirmReenable(
  principal: PrincipalId,
  confirmedBy: PrincipalId,
): Promise<RestorationAudit | null> {
  const decision = await decideRestoration(principal, { requireIdpEnabled: true })
  if (decision.kind !== 'admin-eligible') return null

  const row = await principalRow(principal)
  if (!row) return null
  const label = `${row.iss}|${row.sub}`
  const confirmer = `${canonicalIssuer(confirmedBy.iss)}|${confirmedBy.sub}`
  const { grants, memberships } = await remainingGrants(row)
  await closePeriod(decision.period.id, {
    reEnabledAt: new Date(currentClock.now()),
    restorationType: 'admin-confirmed',
    confirmedBy: confirmer,
  })
  return {
    message: `Confirmed restore of ${label}`,
    detail: {
      principal: label,
      disabledDurationMs: decision.disabledDurationMs,
      restoration: 'admin-confirmed',
      confirmedBy: confirmer,
      grants,
      memberships,
    },
  }
}
