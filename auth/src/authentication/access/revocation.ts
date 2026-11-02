import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from '../../db/database.js'
import {
  backChannelLogoutJtis,
  principalAccessFlags,
  sessionRevocations,
  suspensionRequests,
} from '../../db/schema.js'
import { appendIntent, appendOutcome, type AuditVia } from '../../audit.js'
import { parsePrincipalKey, principalKey, type PrincipalId } from '../session/principal.js'

/**
 * Revocation and suspension (ticket 06).
 *
 * Every mutation appends an audit Intent before it touches the database; when that append
 * fails the mutation is refused with 503, so a revocation can never happen untrailed.
 * There is no cache: `isRevoked` and `isPrincipalAccessRevoked` read the database live.
 */

/** A security suspend waits this long for a second instance admin to confirm it. */
export const SUSPENSION_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000

export type SuspensionRequest = {
  id: string
  principal: PrincipalId
  suspendedBy: PrincipalId
  reason: string
  createdAt: Date
  expiresAt: Date
}

type RevokeOptions = {
  revokedBy: PrincipalId
  reason: string
  /** Test seam: force the audit store to appear unavailable. */
  auditFailure?: boolean
  via?: AuditVia | 'system'
  path?: string
}

type SuspendOptions = {
  suspendedBy: PrincipalId
  reason: string
  auditFailure?: boolean
  via?: AuditVia | 'system'
  path?: string
}

type ConfirmSuspensionOptions = {
  confirmedBy: PrincipalId
  reason: string
  via?: AuditVia | 'system'
  path?: string
}

type SelfSuspendOptions = {
  reason: string
  via?: AuditVia | 'system'
  path?: string
}

type RevokeOnRoleChangeOptions = {
  changedBy: PrincipalId
  reason: string
  via?: AuditVia | 'system'
  path?: string
}

type AuditContext = { via?: AuditVia | 'system'; path?: string; status?: number }

const nowSec = () => Math.floor(Date.now() / 1000)

const unavailable = () =>
  Object.assign(new Error('Audit Intent cannot be appended - audit system unavailable'), { status: 503 })

async function auditIntent(
  action: string,
  principal: PrincipalId,
  actor: PrincipalId,
  message: string,
  context: AuditContext,
  detail: Record<string, unknown> = {},
) {
  try {
    return await appendIntent({
      actor: { ...actor, email: '', name: '' },
      via: context.via ?? 'system',
      method: 'POST',
      path: context.path ?? '/auth/admin/revoke',
      status: 0,
      action,
      message,
      detail: { principal: principalKey(principal), ...detail },
    })
  } catch {
    throw unavailable()
  }
}

function auditOutcome(
  intentId: string,
  action: string,
  principal: PrincipalId,
  actor: PrincipalId,
  message: string,
  context: AuditContext,
  detail: Record<string, unknown> = {},
) {
  return appendOutcome(intentId, {
    actor: { ...actor, email: '', name: '' },
    via: context.via ?? 'system',
    method: 'POST',
    path: context.path ?? '/auth/admin/revoke',
    status: context.status ?? 200,
    action,
    message,
    detail: { principal: principalKey(principal), ...detail },
  })
}

/** Bump the all-credentials cutoff and mark the Principal permanently revoked. */
async function applyPermanentRevocation(tx: Tx, principal: PrincipalId, at: number): Promise<void> {
  const key = principalKey(principal)
  const revokedAt = new Date(at * 1000)
  await tx
    .insert(sessionRevocations)
    .values({ principalKey: key, notBefore: at, revokedAt })
    .onConflictDoUpdate({
      target: sessionRevocations.principalKey,
      set: {
        notBefore: sql`greatest(coalesce(${sessionRevocations.notBefore}, 0), ${at})`,
        revokedAt: sql`coalesce(${sessionRevocations.revokedAt}, ${revokedAt})`,
      },
    })
}

/** End current Sessions and put a `suspension` flag in place; grants are untouched. */
async function applySuspension(
  tx: Tx,
  principal: PrincipalId,
  at: number,
  createdBy: PrincipalId,
  reason: string,
): Promise<void> {
  const key = principalKey(principal)
  await tx
    .insert(sessionRevocations)
    .values({ principalKey: key, notBefore: at })
    .onConflictDoUpdate({
      target: sessionRevocations.principalKey,
      set: { notBefore: sql`greatest(coalesce(${sessionRevocations.notBefore}, 0), ${at})` },
    })

  const [active] = await tx
    .select({ id: principalAccessFlags.id })
    .from(principalAccessFlags)
    .where(and(
      eq(principalAccessFlags.principalKey, key),
      eq(principalAccessFlags.flag, 'suspension'),
      isNull(principalAccessFlags.liftedAt),
    ))
    .limit(1)
  if (active) return

  await tx.insert(principalAccessFlags).values({
    principalKey: key,
    flag: 'suspension',
    reason,
    createdBy: principalKey(createdBy),
    createdAt: new Date(at * 1000),
  })
}

/**
 * Revoke every Session and PAT for a Principal and block a fresh login. 503 when the audit
 * Intent cannot be stored, in which case nothing is revoked.
 */
export async function revokeAll(principal: PrincipalId, options: RevokeOptions): Promise<void> {
  if (options.auditFailure) throw unavailable()
  const at = nowSec()
  const context: AuditContext = { via: options.via, path: options.path ?? '/auth/admin/revoke' }
  const intent = await auditIntent(
    'session.revoke',
    principal,
    options.revokedBy,
    `Revoked by ${principalKey(options.revokedBy)}: ${options.reason}`,
    context,
    { source: 'admin-revocation' },
  )
  await inTransaction((tx) => applyPermanentRevocation(tx, principal, at))
  await auditOutcome(
    intent.id,
    'session.revoke',
    principal,
    options.revokedBy,
    `Revoked all credentials for ${principalKey(principal)}`,
    context,
    { source: 'admin-revocation' },
  )
}

/** Live check: permanently revoked, or a Session started at `sessionStart` predates a cutoff. */
export async function isRevoked(
  principal: PrincipalId,
  options?: { sessionStart?: number },
): Promise<boolean> {
  const [revocation] = await getDb()
    .select()
    .from(sessionRevocations)
    .where(eq(sessionRevocations.principalKey, principalKey(principal)))
    .limit(1)
  if (!revocation) return false

  if (options?.sessionStart !== undefined) {
    if (revocation.notBefore !== null && options.sessionStart <= revocation.notBefore) return true
    if (
      revocation.sessionsNotBefore !== null &&
      options.sessionStart <= revocation.sessionsNotBefore
    ) {
      return true
    }
    return false
  }

  return revocation.revokedAt !== null
}

/** Live check used before a login: permanent revocation or an active Mice suspension flag. */
export async function isPrincipalAccessRevoked(principal: PrincipalId): Promise<boolean> {
  const key = principalKey(principal)
  const [revocation] = await getDb()
    .select({ revokedAt: sessionRevocations.revokedAt })
    .from(sessionRevocations)
    .where(eq(sessionRevocations.principalKey, key))
  if (revocation?.revokedAt) return true

  const [flag] = await getDb()
    .select({ id: principalAccessFlags.id })
    .from(principalAccessFlags)
    .where(and(
      eq(principalAccessFlags.principalKey, key),
      eq(principalAccessFlags.flag, 'suspension'),
      isNull(principalAccessFlags.liftedAt),
    ))
    .limit(1)
  return !!flag
}

/** Open a 24h suspension request; a second instance admin must confirm it. */
export async function suspend(principal: PrincipalId, options: SuspendOptions): Promise<string> {
  if (options.auditFailure) throw unavailable()
  const now = Date.now()
  const id = `susp-${now}-${Math.random().toString(36).slice(2)}`
  const context: AuditContext = { via: options.via, path: options.path ?? '/auth/admin/suspend' }
  const intent = await auditIntent(
    'auth.suspend.request',
    principal,
    options.suspendedBy,
    `Suspension requested by ${principalKey(options.suspendedBy)}: ${options.reason}`,
    context,
    { source: 'admin-suspension' },
  )
  await getDb().insert(suspensionRequests).values({
    id,
    principalKey: principalKey(principal),
    suspendedBy: principalKey(options.suspendedBy),
    reason: options.reason,
    createdAt: new Date(now),
    expiresAt: new Date(now + SUSPENSION_CONFIRM_WINDOW_MS),
  })
  await auditOutcome(
    intent.id,
    'auth.suspend.request',
    principal,
    options.suspendedBy,
    `Suspension requested for ${principalKey(principal)}`,
    context,
    { source: 'admin-suspension', suspension_id: id },
  )
  return id
}

/** Pending, unconfirmed suspensions; expired rows are dropped on read. */
suspend.getPending = async function getPending(): Promise<SuspensionRequest[]> {
  return listPendingSuspensions()
}

export async function listPendingSuspensions(): Promise<SuspensionRequest[]> {
  const nowMs = Date.now()
  const now = new Date(nowMs)
  const db = getDb()
  await db.delete(suspensionRequests).where(and(
    isNull(suspensionRequests.confirmedAt),
    lt(suspensionRequests.expiresAt, now),
  ))
  const rows = await db
    .select()
    .from(suspensionRequests)
    .where(isNull(suspensionRequests.confirmedAt))
  return rows.map((row) => ({
    id: row.id,
    principal: parsePrincipalKey(row.principalKey),
    suspendedBy: parsePrincipalKey(row.suspendedBy),
    reason: row.reason,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }))
}

/** Confirm a pending suspension. Must be a different admin, within 24h. */
export async function confirmSuspension(
  suspensionId: string,
  options: ConfirmSuspensionOptions,
): Promise<void> {
  const [request] = await getDb()
    .select()
    .from(suspensionRequests)
    .where(eq(suspensionRequests.id, suspensionId))
    .limit(1)
  if (!request || request.confirmedAt || request.expiresAt.getTime() <= Date.now()) {
    throw new Error('Suspension request not found or expired')
  }
  if (request.suspendedBy === principalKey(options.confirmedBy)) {
    throw new Error('Cannot confirm suspension: requires a different admin')
  }

  const principal = parsePrincipalKey(request.principalKey)
  const at = nowSec()
  const context: AuditContext = {
    via: options.via,
    path: options.path ?? `/auth/admin/suspend/${suspensionId}/confirm`,
  }
  const intent = await auditIntent(
    'auth.suspend.confirm',
    principal,
    options.confirmedBy,
    `Suspension confirmed by ${principalKey(options.confirmedBy)}: ${options.reason}`,
    context,
    { source: 'admin-suspension', suspension_id: suspensionId },
  )

  await inTransaction(async (tx) => {
    const [confirmed] = await tx
      .update(suspensionRequests)
      .set({ confirmedBy: principalKey(options.confirmedBy), confirmedAt: new Date(at * 1000) })
      .where(and(
        eq(suspensionRequests.id, suspensionId),
        isNull(suspensionRequests.confirmedAt),
      ))
      .returning({ id: suspensionRequests.id })
    if (!confirmed) throw new Error('Suspension request not found or expired')
    await applySuspension(tx, principal, at, options.confirmedBy, options.reason)
  })

  await auditOutcome(
    intent.id,
    'auth.suspend.confirm',
    principal,
    options.confirmedBy,
    `Suspended ${principalKey(principal)}`,
    context,
    { source: 'admin-suspension', suspension_id: suspensionId },
  )
}

/** Immediate self-suspension; no second admin and no confirmation window. */
export async function selfSuspend(
  principal: PrincipalId,
  options: SelfSuspendOptions,
): Promise<void> {
  const at = nowSec()
  const context: AuditContext = { via: options.via, path: options.path ?? '/auth/me/suspend' }
  const intent = await auditIntent(
    'auth.suspend.self',
    principal,
    principal,
    `Self-suspended: ${options.reason}`,
    context,
    { source: 'self-suspension' },
  )
  await inTransaction((tx) =>
    applySuspension(tx, principal, at, principal, `Self-suspended: ${options.reason}`),
  )
  await auditOutcome(
    intent.id,
    'auth.suspend.self',
    principal,
    principal,
    `Suspended ${principalKey(principal)}`,
    context,
    { source: 'self-suspension' },
  )
}

/** End the grant-holder's Sessions so the next request must log in again. PATs stay valid. */
export async function revokeOnRoleChange(
  principals: PrincipalId | PrincipalId[],
  options: RevokeOnRoleChangeOptions,
): Promise<void> {
  const affected = Array.isArray(principals) ? principals : [principals]
  const unique = [...new Map(affected.map((p) => [principalKey(p), p])).values()]
  if (unique.length === 0) return

  const at = nowSec()
  const context: AuditContext = { via: options.via, path: options.path ?? '/auth/admin' }
  const intent = await auditIntent(
    'session.role_change',
    unique[0]!,
    options.changedBy,
    `Role/grant changed by ${principalKey(options.changedBy)}: ${options.reason}`,
    context,
    {
      source: 'role-change',
      principals: unique.map(principalKey),
    },
  )

  await inTransaction(async (tx) => {
    for (const principal of unique) {
      await tx
        .insert(sessionRevocations)
        .values({ principalKey: principalKey(principal), sessionsNotBefore: at })
        .onConflictDoUpdate({
          target: sessionRevocations.principalKey,
          set: {
            sessionsNotBefore: sql`greatest(coalesce(${sessionRevocations.sessionsNotBefore}, 0), ${at})`,
          },
        })
    }
  })

  await auditOutcome(
    intent.id,
    'session.role_change',
    unique[0]!,
    options.changedBy,
    `Forced fresh login for ${unique.length} Principal(s)`,
    context,
    { source: 'role-change', principals: unique.map(principalKey) },
  )
}

/**
 * Consume a back-channel logout `jti` once. Returns false when it was already used, so the
 * caller can reject the replay. Expired ids are purged first.
 */
export async function consumeBackChannelJti(
  jti: string,
  expiresAtSec: number,
): Promise<boolean> {
  const db = getDb()
  const now = new Date()
  await db.delete(backChannelLogoutJtis).where(lt(backChannelLogoutJtis.expiresAt, now))
  const [row] = await db
    .insert(backChannelLogoutJtis)
    .values({ jti, consumedAt: now, expiresAt: new Date(expiresAtSec * 1000) })
    .onConflictDoNothing({ target: backChannelLogoutJtis.jti })
    .returning({ jti: backChannelLogoutJtis.jti })
  return !!row
}
