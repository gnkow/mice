import { and, gte, lte, desc, sql } from 'drizzle-orm'
import { getDb } from '../../db/database.js'
import { authEvents } from '../../db/schema.js'
import { hashIp } from '../../ipHash.js'
import { principalKey, type PrincipalId } from '../session/principal.js'

export type AuthEventType = 'login' | 'logout' | 'refresh' | 'step-up' | 'revocation' | 'access'

export type AuthEvent = {
  id?: number
  type: AuthEventType
  principalKey: string
  requestId: string
  outcome: 'success' | 'failure'
  reason?: string
  hashedIp?: string
  timestamp?: Date
}

type AuthEventInput = {
  type: AuthEventType
  principal: PrincipalId
  requestId: string
  outcome: 'success' | 'failure'
  reason?: string
  /** Client address. Stored only as today's hash. */
  clientIp?: string
  // These fields should be stripped if present
  token?: unknown
  accessToken?: unknown
  cookie?: unknown
  code?: unknown
  authorizationCode?: unknown
  ipAddress?: unknown
}

/**
 * Records an authentication event with redaction of sensitive data.
 * Never logs tokens, cookies, codes, or IP addresses per ticket 05 requirements.
 */
export async function recordAuthEvent(input: AuthEventInput): Promise<void> {
  // Strip all sensitive fields - only record type, principal, requestId, outcome, reason
  const hashedIp = await hashIp(input.clientIp)
  const safeEvent = {
    type: input.type,
    principalKey: principalKey(input.principal),
    requestId: input.requestId,
    outcome: input.outcome,
    reason: input.reason,
    hashedIp,
    timestamp: new Date(Date.now()), // Use Date.now() to allow test mocking
  }

  await getDb().insert(authEvents).values(safeEvent)
}

/**
 * Queries authentication events for a Principal within a specific month.
 * Returns all events (login, logout, refresh, step-up, failure, revocation).
 */
export async function queryAuthEventsByPrincipal(
  principal: PrincipalId,
  options: { month: string },
): Promise<AuthEvent[]> {
  const key = principalKey(principal)
  
  // Parse month (format: YYYY-MM)
  const [year, month] = options.month.split('-').map(Number)
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0, 23, 59, 59, 999)

  const results = await getDb()
    .select()
    .from(authEvents)
    .where(
      and(
        sql`${authEvents.principalKey} = ${key}`,
        gte(authEvents.timestamp, startDate),
        lte(authEvents.timestamp, endDate),
      ),
    )
    .orderBy(desc(authEvents.timestamp))

  return results.map((row) => ({
    id: row.id,
    type: row.type as AuthEventType,
    principalKey: row.principalKey,
    requestId: row.requestId,
    outcome: row.outcome as 'success' | 'failure',
    reason: row.reason ?? undefined,
    ...(row.hashedIp ? { hashedIp: row.hashedIp } : {}),
    timestamp: row.timestamp,
  }))
}

export type FailureAlert = {
  principal: string
  failureCount: number
  windowMinutes: number
  events: AuthEvent[]
}

/**
 * Checks if a Principal has exceeded the failure threshold (5 failures in 10 minutes).
 * Triggers an alert callback if the threshold is exceeded.
 */
export async function checkFailureRate(
  principal: PrincipalId,
  options: { onAlert?: (alert: FailureAlert) => void } = {},
): Promise<boolean> {
  const key = principalKey(principal)
  const windowMinutes = 10
  const threshold = 5
  
  // Get failures in the last 10 minutes
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000)
  
  const failures = await getDb()
    .select()
    .from(authEvents)
    .where(
      and(
        sql`${authEvents.principalKey} = ${key}`,
        sql`${authEvents.outcome} = 'failure'`,
        gte(authEvents.timestamp, cutoff),
      ),
    )
    .orderBy(desc(authEvents.timestamp))

  const failureCount = failures.length

  if (failureCount >= threshold) {
    const alert: FailureAlert = {
      principal: key,
      failureCount,
      windowMinutes,
      events: failures.map((row) => ({
        id: row.id,
        type: row.type as AuthEventType,
        principalKey: row.principalKey,
        requestId: row.requestId,
        outcome: row.outcome as 'success' | 'failure',
        reason: row.reason ?? undefined,
        timestamp: row.timestamp,
      })),
    }
    
    options.onAlert?.(alert)
    return true
  }

  return false
}
