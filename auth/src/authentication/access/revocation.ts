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
 * Every mutation goes through `runAuditedAccessMutation`: Intent first, then the
 * database write, then Outcome. When Intent append fails the mutation is refused
 * with 503, so a revocation can never happen untrailed. There is no cache:
 * `isRevoked` and `isPrincipalAccessRevoked` read the database live.
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

type AuditedMutation<T> = {
  action: string
  principal: PrincipalId
  actor: PrincipalId
  intentMessage: string
  outcomeMessage: string
  context: AuditContext
  detail?: Record<string, unknown>
  outcomeDetail?: Record<string, unknown>
  auditFailure?: boolean
  mutate: () => Promise<T>
}

const nowSec = () => Math.floor(Date.now() / 1000)

const unavailable = () =>
  Object.assign(new Error('Audit Intent cannot be appended - audit system unavailable'), { status: 503 })

/**
 * Deep seam for every revoke/suspend mutation: Intent must land before any write;
 * Outcome follows the write. Callers only supply messages and the mutate body.
 */
async function runAuditedAccessMutation<T>(args: AuditedMutation<T>): Promise<T> {
  if (args.auditFailure) throw unavailable()
  const detail = args.detail ?? {}
  let intent
  try {
    intent = await appendIntent({
      actor: { ...args.actor, email: '', name: '' },
      via: args.context.via ?? 'system',
      method: 'POST',
      path: args.context.path ?? '/auth/admin/revoke',
      status: 0,
      action: args.action,
      message: args.intentMessage,
      detail: { principal: principalKey(args.principal), ...detail },
    })
  } catch {
    throw unavailable()
  }

  const result = await args.mutate()

  await appendOutcome(intent.id, {
    actor: { ...args.actor, email: '', name: '' },
    via: args.context.via ?? 'system',
    method: 'POST',
    path: args.context.path ?? '/auth/admin/revoke',
    status: args.context.status ?? 200,
    action: args.action,
    message: args.outcomeMessage,
    detail: { principal: principalKey(args.principal), ...(args.outcomeDetail ?? detail) },
  })
  return result
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
  const at = nowSec()
  await runAuditedAccessMutation({
    action: 'session.revoke',
    principal,
    actor: options.revokedBy,
    intentMessage: `Revoked by ${principalKey(options.revokedBy)}: ${options.reason}`,
    outcomeMessage: `Revoked all credentials for ${principalKey(principal)}`,
    context: { via: options.via, path: options.path ?? '/auth/admin/revoke' },
    detail: { source: 'admin-revocation' },
    auditFailure: options.auditFailure,
    mutate: () => inTransaction((tx) => applyPermanentRevocation(tx, principal, at)),
  })
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
  const now = Date.now()
  const id = `susp-${now}-${Math.random().toString(36).slice(2)}`
  return runAuditedAccessMutation({
    action: 'auth.suspend.request',
    principal,
    actor: options.suspendedBy,
    intentMessage: `Suspension requested by ${principalKey(options.suspendedBy)}: ${options.reason}`,
    outcomeMessage: `Suspension requested for ${principalKey(principal)}`,
    context: { via: options.via, path: options.path ?? '/auth/admin/suspend' },
    detail: { source: 'admin-suspension' },
    outcomeDetail: { source: 'admin-suspension', suspension_id: id },
    auditFailure: options.auditFailure,
    mutate: async () => {
      await getDb().insert(suspensionRequests).values({
        id,
        principalKey: principalKey(principal),
        suspendedBy: principalKey(options.suspendedBy),
        reason: options.reason,
        createdAt: new Date(now),
        expiresAt: new Date(now + SUSPENSION_CONFIRM_WINDOW_MS),
      })
      return id
    },
  })
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

export class SuspensionConfirmError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'same_admin',
  ) {
    super(message)
    this.name = 'SuspensionConfirmError'
  }
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
    throw new SuspensionConfirmError('Suspension request not found or expired', 'not_found')
  }
  if (request.suspendedBy === principalKey(options.confirmedBy)) {
    throw new SuspensionConfirmError(
      'Cannot confirm suspension: requires a different admin',
      'same_admin',
    )
  }

  const principal = parsePrincipalKey(request.principalKey)
  const at = nowSec()
  await runAuditedAccessMutation({
    action: 'auth.suspend.confirm',
    principal,
    actor: options.confirmedBy,
    intentMessage: `Suspension confirmed by ${principalKey(options.confirmedBy)}: ${options.reason}`,
    outcomeMessage: `Suspended ${principalKey(principal)}`,
    context: {
      via: options.via,
      path: options.path ?? `/auth/admin/suspend/${suspensionId}/confirm`,
    },
    detail: { source: 'admin-suspension', suspension_id: suspensionId },
    mutate: () => inTransaction(async (tx) => {
      const [confirmed] = await tx
        .update(suspensionRequests)
        .set({ confirmedBy: principalKey(options.confirmedBy), confirmedAt: new Date(at * 1000) })
        .where(and(
          eq(suspensionRequests.id, suspensionId),
          isNull(suspensionRequests.confirmedAt),
        ))
        .returning({ id: suspensionRequests.id })
      if (!confirmed) {
        throw new SuspensionConfirmError('Suspension request not found or expired', 'not_found')
      }
      await applySuspension(tx, principal, at, options.confirmedBy, options.reason)
    }),
  })
}

/** Immediate self-suspension; no second admin and no confirmation window. */
export async function selfSuspend(
  principal: PrincipalId,
  options: SelfSuspendOptions,
): Promise<void> {
  const at = nowSec()
  await runAuditedAccessMutation({
    action: 'auth.suspend.self',
    principal,
    actor: principal,
    intentMessage: `Self-suspended: ${options.reason}`,
    outcomeMessage: `Suspended ${principalKey(principal)}`,
    context: { via: options.via, path: options.path ?? '/auth/me/suspend' },
    detail: { source: 'self-suspension' },
    mutate: () => inTransaction((tx) =>
      applySuspension(tx, principal, at, principal, `Self-suspended: ${options.reason}`),
    ),
  })
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
  await runAuditedAccessMutation({
    action: 'session.role_change',
    principal: unique[0]!,
    actor: options.changedBy,
    intentMessage: `Role/grant changed by ${principalKey(options.changedBy)}: ${options.reason}`,
    outcomeMessage: `Forced fresh login for ${unique.length} Principal(s)`,
    context: { via: options.via, path: options.path ?? '/auth/admin' },
    detail: {
      source: 'role-change',
      principals: unique.map(principalKey),
    },
    mutate: () => inTransaction(async (tx) => {
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
    }),
  })
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
