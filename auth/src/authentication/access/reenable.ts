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

async function principalRow(principal: PrincipalId) {
  const [row] = await getDb()
    .select({ id: principals.id, iss: principals.iss, sub: principals.sub })
    .from(principals)
    .where(and(eq(principals.iss, canonicalIssuer(principal.iss)), eq(principals.sub, principal.sub)))
    .limit(1)
  return row ?? null
}

/** Records the first time this Principal is seen IdP-disabled. A later detection keeps the original time. */
export async function recordIdpDisabled(principal: PrincipalId & { name?: string; email?: string }): Promise<void> {
  await ensurePrincipal(principal)
  const row = await principalRow(principal)
  if (!row) return
  const [open] = await getDb()
    .select({ id: principalDisabledPeriods.id })
    .from(principalDisabledPeriods)
    .where(and(eq(principalDisabledPeriods.principalId, row.id), isNull(principalDisabledPeriods.reEnabledAt)))
    .limit(1)
  if (open) return
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
  const now = currentClock.now()
  const periods: ReenablePeriod[] = []
  for (const row of rows) {
    const elapsed = now - row.disabledAt.getTime()
    const idpStatus = await lookupKeycloakUserStatus(row.sub)
    periods.push({
      principal: `${row.iss}|${row.sub}`,
      disabledAt: row.disabledAt.toISOString(),
      awaitingConfirmation: idpStatus === 'enabled' && elapsed > REENABLE_WINDOW_MS,
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

async function remainingGrants(user: { iss: string; sub: string; groups?: string[] }) {
  const grants = await instancePermissions(user)
  const memberships = (await membershipRefs({ key: principalKey(user), groups: user.groups ?? [] }))
    .map((membership) => `${membership.namespace}:${membership.role}`)
  return { grants, memberships }
}

/** Closes an open disable that is still inside the window. A longer one stays blocked for an admin. */
export async function considerReenable(
  user: SessionUser,
  audit: (event: RestorationAudit) => Promise<string | null>,
): Promise<'allow' | 'awaiting-confirmation'> {
  const row = await principalRow(user)
  if (!row) return 'allow'
  const [open] = await getDb()
    .select({ id: principalDisabledPeriods.id, disabledAt: principalDisabledPeriods.disabledAt })
    .from(principalDisabledPeriods)
    .where(and(eq(principalDisabledPeriods.principalId, row.id), isNull(principalDisabledPeriods.reEnabledAt)))
    .limit(1)
  if (!open) return 'allow'
  const now = currentClock.now()
  const disabledDurationMs = now - open.disabledAt.getTime()
  if (disabledDurationMs > REENABLE_WINDOW_MS) {
    await getDb()
      .update(principalDisabledPeriods)
      .set({ restorationType: 'pending' })
      .where(eq(principalDisabledPeriods.id, open.id))
    return 'awaiting-confirmation'
  }
  if (await isSuspended(user)) return 'allow'
  const principal = `${row.iss}|${row.sub}`
  const { grants, memberships } = await remainingGrants(user)
  const auditEventId = await audit({
    message: `Restored ${principal}`,
    detail: {
      principal,
      disabledDurationMs,
      restoration: 'automatic',
      grants,
      memberships,
    },
  })
  await getDb()
    .update(principalDisabledPeriods)
    .set({
      reEnabledAt: new Date(now),
      restorationType: 'automatic',
      auditEventId,
    })
    .where(eq(principalDisabledPeriods.id, open.id))
  return 'allow'
}

/** Closes a long disable after an admin confirms it. Returns the audit payload, or null when confirmation is not due. */
export async function confirmReenable(
  principal: PrincipalId,
  confirmedBy: PrincipalId,
): Promise<RestorationAudit | null> {
  const row = await principalRow(principal)
  if (!row) return null
  const [open] = await getDb()
    .select({ id: principalDisabledPeriods.id, disabledAt: principalDisabledPeriods.disabledAt })
    .from(principalDisabledPeriods)
    .where(and(eq(principalDisabledPeriods.principalId, row.id), isNull(principalDisabledPeriods.reEnabledAt)))
    .limit(1)
  if (!open) return null
  const now = currentClock.now()
  const disabledDurationMs = now - open.disabledAt.getTime()
  if (disabledDurationMs <= REENABLE_WINDOW_MS) return null
  if (await lookupKeycloakUserStatus(row.sub) !== 'enabled') return null
  const label = `${row.iss}|${row.sub}`
  const confirmer = `${canonicalIssuer(confirmedBy.iss)}|${confirmedBy.sub}`
  const { grants, memberships } = await remainingGrants(row)
  await getDb()
    .update(principalDisabledPeriods)
    .set({
      reEnabledAt: new Date(now),
      restorationType: 'admin-confirmed',
      confirmedBy: confirmer,
    })
    .where(eq(principalDisabledPeriods.id, open.id))
  return {
    message: `Confirmed restore of ${label}`,
    detail: {
      principal: label,
      disabledDurationMs,
      restoration: 'admin-confirmed',
      confirmedBy: confirmer,
      grants,
      memberships,
    },
  }
}
