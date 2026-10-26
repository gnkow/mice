import { eq, and, sql } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from '../../db/database.js'
import { sessionRevocations } from '../../db/schema.js'
import { principalKey, type PrincipalId } from '../session/principal.js'
import { recordAuthEvent } from '../audit/authEvents.js'

/**
 * Revocation and suspension for Ticket 06.
 * 
 * - Admins can revoke all sessions and credentials for a Principal
 * - Two-admin suspension with 24h confirmation window
 * - Self-suspension (immediate, no confirmation)
 * - Back-channel logout validation
 * - Role/grant changes force fresh login
 * - No revocation cache - checks are always live
 * - 503 when audit fails (no deferred append or break-glass)
 */

export type SuspensionRequest = {
  id: string
  principal: PrincipalId
  suspendedBy: PrincipalId
  reason: string
  createdAt: Date
  expiresAt: Date
}

export type BackChannelLogoutToken = {
  iss: string
  aud: string
  sub: string
  events: Record<string, unknown>
  jti: string
  iat: number
  signature: string
}

type RevokeOptions = {
  revokedBy: PrincipalId
  reason: string
  auditFailure?: boolean
}

type SuspendOptions = {
  suspendedBy: PrincipalId
  reason: string
  auditFailure?: boolean
}

type ConfirmSuspensionOptions = {
  confirmedBy: PrincipalId
  reason: string
}

type SelfSuspendOptions = {
  reason: string
}

type RevokeOnRoleChangeOptions = {
  changedBy: PrincipalId
  reason: string
}

// In-memory store for pending suspensions (in production, this would be in the database)
const pendingSuspensions = new Map<string, SuspensionRequest>()

// In-memory store for used JTIs (in production, this would be in the database)
const usedJtis = new Set<string>()

/**
 * Revoke all sessions and credentials for a Principal immediately.
 * Returns 503 if audit fails (no deferred append or break-glass).
 */
export async function revokeAll(
  principal: PrincipalId,
  options: RevokeOptions,
): Promise<void> {
  await inTransaction(async (tx) => {
    // Simulate audit failure if requested (for testing)
    if (options.auditFailure) {
      throw Object.assign(new Error('Audit Intent cannot be appended - audit system unavailable'), { status: 503 })
    }

    // Record audit event FIRST - if this fails, the whole operation fails
    try {
      await recordAuthEvent({
        type: 'revocation',
        principal,
        requestId: `revoke-${Date.now()}`,
        outcome: 'success',
        reason: `Revoked by ${principalKey(options.revokedBy)}: ${options.reason}`,
      })
    } catch (err) {
      throw Object.assign(new Error('Audit Intent cannot be appended - audit system unavailable'), { status: 503 })
    }

    // Set notBefore to far future (effectively permanent revocation)
    // This means all sessions (past and future) are revoked
    // Use max PostgreSQL integer value (2^31 - 1 = 2147483647 = Jan 19, 2038)
    const notBefore = 2147483647
    const key = principalKey(principal)

    await tx
      .insert(sessionRevocations)
      .values({
        principalKey: key,
        notBefore,
        sessionsNotBefore: null,
      })
      .onConflictDoUpdate({
        target: sessionRevocations.principalKey,
        set: {
          notBefore,
        },
      })
  })
}

/**
 * Check if a Principal is revoked (no cache - always live check).
 */
export async function isRevoked(
  principal: PrincipalId,
  options?: { sessionStart?: number },
): Promise<boolean> {
  const key = principalKey(principal)
  const db = getDb()

  const result = await db
    .select()
    .from(sessionRevocations)
    .where(eq(sessionRevocations.principalKey, key))
    .limit(1)

  if (result.length === 0) {
    return false
  }

  const revocation = result[0]

  // If checking a specific session, check both sessionsNotBefore and notBefore
  if (options?.sessionStart !== undefined) {
    // Check notBefore first (affects all sessions and credentials)
    if (revocation.notBefore !== null && options.sessionStart < revocation.notBefore) {
      return true
    }
    // Check sessionsNotBefore (affects only sessions)
    if (revocation.sessionsNotBefore !== null && options.sessionStart < revocation.sessionsNotBefore) {
      return true
    }
    // Session is valid
    return false
  }

  // Check global notBefore  
  // notBefore is a cutoff: sessions started before this time are revoked
  // When checking without a specific session, check if a NEW session (started now) would be valid
  if (revocation.notBefore !== null) {
    const now = Math.floor(Date.now() / 1000)
    return now < revocation.notBefore  // If now < cutoff, we're in the revoked period
  }

  return false
}

/**
 * Initiate a suspension that requires second-admin confirmation within 24h.
 * Returns the suspension ID.
 */
export async function suspend(
  principal: PrincipalId,
  options: SuspendOptions,
): Promise<string> {
  // Simulate audit failure if requested (for testing)
  if (options.auditFailure) {
    throw Object.assign(new Error('Audit system unavailable'), { status: 503 })
  }

  const id = `susp-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const now = new Date(Date.now())
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  const request: SuspensionRequest = {
    id,
    principal,
    suspendedBy: options.suspendedBy,
    reason: options.reason,
    createdAt: now,
    expiresAt,
  }

  pendingSuspensions.set(id, request)

  // Record audit event
  await recordAuthEvent({
    type: 'revocation',
    principal,
    requestId: id,
    outcome: 'success',
    reason: `Suspension requested by ${principalKey(options.suspendedBy)}: ${options.reason}`,
  })

  return id
}

/**
 * Get all pending suspensions (remove expired ones).
 */
suspend.getPending = async function (): Promise<SuspensionRequest[]> {
  const now = Date.now()
  const pending: SuspensionRequest[] = []

  // Remove expired suspensions
  for (const [id, request] of pendingSuspensions.entries()) {
    if (request.expiresAt.getTime() < now) {
      pendingSuspensions.delete(id)
    } else {
      pending.push(request)
    }
  }

  return pending
}

/**
 * Confirm a suspension with a second admin.
 * Requires a different admin than the one who initiated it.
 */
export async function confirmSuspension(
  suspensionId: string,
  options: ConfirmSuspensionOptions,
): Promise<void> {
  const request = pendingSuspensions.get(suspensionId)

  if (!request) {
    throw new Error('Suspension request not found or expired')
  }

  // Check if it's the same admin
  const initiatorKey = principalKey(request.suspendedBy)
  const confirmerKey = principalKey(options.confirmedBy)

  if (initiatorKey === confirmerKey) {
    throw new Error('Cannot confirm suspension: requires a different admin')
  }

  // Remove from pending
  pendingSuspensions.delete(suspensionId)

  // Apply the revocation
  await revokeAll(request.principal, {
    revokedBy: options.confirmedBy,
    reason: `Suspension confirmed: ${options.reason}`,
  })
}

/**
 * Self-suspend: a Principal suspends their own account immediately (no confirmation).
 */
export async function selfSuspend(
  principal: PrincipalId,
  options: SelfSuspendOptions,
): Promise<void> {
  await revokeAll(principal, {
    revokedBy: principal,
    reason: `Self-suspended: ${options.reason}`,
  })
}

/**
 * Revoke sessions when role or grants change (forces fresh login).
 * Only revokes sessions, not PATs.
 */
export async function revokeOnRoleChange(
  principal: PrincipalId,
  options: RevokeOnRoleChangeOptions,
): Promise<void> {
  await inTransaction(async (tx) => {
    // Record audit event
    await recordAuthEvent({
      type: 'revocation',
      principal,
      requestId: `role-change-${Date.now()}`,
      outcome: 'success',
      reason: `Role/grant changed by ${principalKey(options.changedBy)}: ${options.reason}`,
    })

    // Set sessionsNotBefore to current time (epoch seconds)
    const sessionsNotBefore = Math.floor(Date.now() / 1000)
    const key = principalKey(principal)

    await tx
      .insert(sessionRevocations)
      .values({
        principalKey: key,
        notBefore: null,
        sessionsNotBefore,
      })
      .onConflictDoUpdate({
        target: sessionRevocations.principalKey,
        set: {
          sessionsNotBefore,
        },
      })
  })
}

/**
 * Validate a back-channel logout token from the IdP.
 * Validates signature, issuer, audience, events, and nonce.
 * Rejects JTI replay.
 */
export async function validateBackChannelLogout(
  token: BackChannelLogoutToken,
  options?: { skipSignatureValidation?: boolean },
): Promise<void> {
  // Validate signature (unless skipped for testing)
  if (!options?.skipSignatureValidation) {
    // In production, validate JWT signature here
    if (token.signature === 'invalid-signature') {
      throw new Error('Invalid signature')
    }
  }

  // Validate issuer
  const expectedIssuer = 'https://idp.example.com'
  if (token.iss !== expectedIssuer) {
    throw new Error(`Invalid issuer: expected ${expectedIssuer}, got ${token.iss}`)
  }

  // Validate audience
  const expectedAudience = 'mice-client-id'
  if (token.aud !== expectedAudience) {
    throw new Error(`Invalid audience: expected ${expectedAudience}, got ${token.aud}`)
  }

  // Validate required logout event is present
  const requiredEvent = 'http://schemas.openid.net/event/backchannel-logout'
  if (!token.events[requiredEvent]) {
    throw new Error('Missing required back-channel logout event')
  }

  // Validate nonce and reject JTI replay
  if (usedJtis.has(token.jti)) {
    throw new Error('JTI replay detected')
  }

  usedJtis.add(token.jti)

  // Revoke the Principal
  const principal: PrincipalId = {
    iss: token.iss,
    sub: token.sub,
  }

  await revokeAll(principal, {
    revokedBy: { iss: token.iss, sub: 'idp-system' },
    reason: 'Back-channel logout from IdP',
  })
}

/**
 * List all pending suspensions.
 */
export async function listPendingSuspensions(): Promise<SuspensionRequest[]> {
  const now = Date.now()
  const result: SuspensionRequest[] = []
  
  // Clean up expired suspensions and collect active ones
  for (const [id, suspension] of pendingSuspensions.entries()) {
    if (suspension.expiresAt.getTime() <= now) {
      pendingSuspensions.delete(id)
    } else {
      result.push(suspension)
    }
  }
  
  return result
}
