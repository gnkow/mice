import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb, inTransaction } from '../../db/database.js'
import { principalAccessFlags, principalAccessStates, sessionRevocations } from '../../db/schema.js'
import { directoryNow, lookupKeycloakUserStatus, type DirectoryUserStatus } from '../directory/directory.js'
import { recordAuthEvent } from '../audit/authEvents.js'
import { principalKey, type PrincipalId } from '../session/principal.js'
import type { SessionUser } from '../session/session.js'

/** A Principal disabled for longer than this needs an admin to re-confirm access. */
export const ACCESS_RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export type AccessDenialCode =
  | 'IDP_UNAVAILABLE'
  | 'ACCESS_SUSPENDED'
  | 'ACCESS_REVOKED'
  | 'RESTORE_REQUIRES_APPROVAL'

export type AccessDecision =
  | { allowed: true; restored: boolean }
  | { allowed: false; status: 403 | 503; code: AccessDenialCode; error: string }

export type AccessFlag = {
  id: number
  flag: string
  reason: string
  createdBy: string
  createdAt: Date
}

export type AccessState = {
  principalKey: string
  idpDisabledAt: Date | null
  restoreDeadline: Date | null
  restoreRequiresApproval: boolean
  flags: AccessFlag[]
}

const allow = (restored = false): AccessDecision => ({ allowed: true, restored })
const deny = (code: AccessDenialCode, status: 403 | 503, error: string): AccessDecision => ({
  allowed: false,
  code,
  status,
  error,
})

const keyOf = (principal: PrincipalId): string => principalKey(principal)

async function getStoredState(principal: PrincipalId) {
  const [row] = await getDb()
    .select()
    .from(principalAccessStates)
    .where(eq(principalAccessStates.principalKey, keyOf(principal)))
    .limit(1)
  return row
}

async function activeFlags(principal: PrincipalId): Promise<AccessFlag[]> {
  const rows = await getDb()
    .select()
    .from(principalAccessFlags)
    .where(and(
      eq(principalAccessFlags.principalKey, keyOf(principal)),
      isNull(principalAccessFlags.liftedAt),
    ))
  return rows.map((r) => ({
    id: r.id,
    flag: r.flag,
    reason: r.reason,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }))
}

/** Mark the first moment a live check saw the Principal disabled or missing. */
async function markIdpDisabled(principal: PrincipalId, now: number): Promise<void> {
  const key = keyOf(principal)
  await inTransaction(async (tx) => {
    await tx
      .insert(principalAccessStates)
      .values({
        principalKey: key,
        idpDisabledAt: new Date(now),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .onConflictDoUpdate({
        target: principalAccessStates.principalKey,
        set: {
          idpDisabledAt: sql`coalesce(${principalAccessStates.idpDisabledAt}, ${new Date(now)})`,
          updatedAt: new Date(now),
        },
      })
  })
}

async function markRestoreNeedsApproval(principal: PrincipalId, now: number): Promise<void> {
  await getDb()
    .update(principalAccessStates)
    .set({ restoreRequiresApproval: true, updatedAt: new Date(now) })
    .where(eq(principalAccessStates.principalKey, keyOf(principal)))
}

async function clearIdpDisabled(
  principal: PrincipalId,
  now: number,
  reason: string,
): Promise<void> {
  const key = keyOf(principal)
  await recordAuthEvent({
    type: 'access',
    principal,
    requestId: `access-restore-${now}`,
    outcome: 'success',
    reason,
  })
  await getDb()
    .update(principalAccessStates)
    .set({ idpDisabledAt: null, restoreRequiresApproval: false, updatedAt: new Date(now) })
    .where(eq(principalAccessStates.principalKey, key))
}

/**
 * The one access decision for a Principal: live IdP status, the 30-day restore window, and
 * Mice flags. Called on login and on every authenticated request. No cached status.
 */
export async function evaluateAccess(
  user: SessionUser,
  options: { status?: DirectoryUserStatus; now?: number } = {},
): Promise<AccessDecision> {
  const now = options.now ?? Date.now()
  const principal = { iss: user.iss, sub: user.sub }
  const [revocation] = await getDb()
    .select({ revokedAt: sessionRevocations.revokedAt })
    .from(sessionRevocations)
    .where(eq(sessionRevocations.principalKey, keyOf(principal)))
    .limit(1)
  if (revocation?.revokedAt) {
    return deny('ACCESS_REVOKED', 403, 'ACCESS_REVOKED: this Principal has been permanently revoked')
  }

  let status = options.status
  if (!status) {
    if (!directoryNow().configured) return allow()
    status = await lookupKeycloakUserStatus(user.sub)
  }
  if (status === 'error') {
    return deny('IDP_UNAVAILABLE', 503, 'Service Unavailable - IdP check failed')
  }

  const state = await getStoredState(principal)
  const flags = await activeFlags(principal)

  if (status === 'disabled' || status === 'missing') {
    await markIdpDisabled(principal, now)
    return deny(
      'ACCESS_SUSPENDED',
      403,
      `ACCESS_SUSPENDED: ${status === 'disabled' ? 'disabled' : 'missing'} in the IdP`,
    )
  }

  if (state?.idpDisabledAt) {
    const disabledAt = state.idpDisabledAt.getTime()
    const tooOld = now - disabledAt > ACCESS_RESTORE_WINDOW_MS
    if (state.restoreRequiresApproval || tooOld) {
      if (tooOld && !state.restoreRequiresApproval) await markRestoreNeedsApproval(principal, now)
      return deny(
        'RESTORE_REQUIRES_APPROVAL',
        403,
        'RESTORE_REQUIRES_APPROVAL: disabled for more than 30 days; an administrator must re-confirm access',
      )
    }
    if (flags.length === 0) {
      await clearIdpDisabled(principal, now, 'access.restored: disabled 30 days or less with no Mice flag')
      return allow(true)
    }
  }

  if (flags.length > 0) {
    return deny(
      'ACCESS_SUSPENDED',
      403,
      `ACCESS_SUSPENDED: Mice flag active (${flags.map((f) => f.flag).join(', ')})`,
    )
  }

  return allow()
}

/** Add a Mice flag. The Principal's grants stay in place; only access is suspended. */
export async function setAccessFlag(
  principal: PrincipalId,
  options: { flag?: string; reason: string; createdBy: PrincipalId; now?: number },
): Promise<number> {
  const now = options.now ?? Date.now()
  const [row] = await getDb()
    .insert(principalAccessFlags)
    .values({
      principalKey: keyOf(principal),
      flag: options.flag?.trim() || 'mice',
      reason: options.reason,
      createdBy: keyOf(options.createdBy),
      createdAt: new Date(now),
    })
    .returning({ id: principalAccessFlags.id })
  await recordAuthEvent({
    type: 'access',
    principal,
    requestId: `access-flag-${row!.id}`,
    outcome: 'success',
    reason: `access.flag_set by ${keyOf(options.createdBy)}: ${options.reason}`,
  })
  return row!.id
}

/** Lift one Mice flag. Access is re-evaluated on the next request; grants were never removed. */
export async function liftAccessFlag(
  principal: PrincipalId,
  flagId: number,
  options: { liftedBy: PrincipalId; reason: string; now?: number },
): Promise<boolean> {
  const now = options.now ?? Date.now()
  const [row] = await getDb()
    .update(principalAccessFlags)
    .set({
      liftedBy: keyOf(options.liftedBy),
      liftedAt: new Date(now),
      liftReason: options.reason,
    })
    .where(and(
      eq(principalAccessFlags.id, flagId),
      eq(principalAccessFlags.principalKey, keyOf(principal)),
      isNull(principalAccessFlags.liftedAt),
    ))
    .returning({ id: principalAccessFlags.id })
  if (!row) return false
  await recordAuthEvent({
    type: 'access',
    principal,
    requestId: `access-flag-lift-${flagId}`,
    outcome: 'success',
    reason: `access.flag_lifted by ${keyOf(options.liftedBy)}: ${options.reason}`,
  })
  return true
}

/** Admin re-confirmation after a long IdP disable. Does not lift Mice flags. */
export async function confirmAccessRestore(
  principal: PrincipalId,
  options: { confirmedBy: PrincipalId; reason: string; now?: number },
): Promise<boolean> {
  const now = options.now ?? Date.now()
  const state = await getStoredState(principal)
  if (!state?.idpDisabledAt && !state?.restoreRequiresApproval) return false
  await clearIdpDisabled(
    principal,
    now,
    `access.restore_confirmed by ${keyOf(options.confirmedBy)}: ${options.reason}`,
  )
  return true
}

/** Current access state for the admin panel. */
export async function getAccessState(principal: PrincipalId): Promise<AccessState> {
  const state = await getStoredState(principal)
  const disabledAt = state?.idpDisabledAt ?? null
  return {
    principalKey: keyOf(principal),
    idpDisabledAt: disabledAt,
    restoreDeadline: disabledAt ? new Date(disabledAt.getTime() + ACCESS_RESTORE_WINDOW_MS) : null,
    restoreRequiresApproval: state?.restoreRequiresApproval ?? false,
    flags: await activeFlags(principal),
  }
}
