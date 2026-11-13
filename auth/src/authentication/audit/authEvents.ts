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

export type FailureAlert = {
  principal: string
  failureCount: number
  windowMinutes: number
  events: AuthEvent[]
}

type AuthEventInput = {
  type: AuthEventType
  principal: PrincipalId
  requestId: string
  outcome: 'success' | 'failure'
  reason?: string
  /** Client address. Stored only as today's hash. */
  clientIp?: string
  /**
   * Invoked when this failure pushes the Principal over 5 failures in 10 minutes.
   * Ignored for successful outcomes.
   */
  onAlert?: (alert: FailureAlert) => void
  // These fields should be stripped if present
  token?: unknown
  accessToken?: unknown
  cookie?: unknown
  code?: unknown
  authorizationCode?: unknown
  ipAddress?: unknown
}

export type RecordAuthEventResult = {
  /** True when this write triggered the in-process failure-rate alert. */
  alerted: boolean
}

export type StoredAuthEvent = {
  type: AuthEventType
  principalKey: string
  requestId: string
  outcome: 'success' | 'failure'
  reason?: string
  hashedIp: string | null
  timestamp: Date
}

export type AuthEventHashIp = (ip: string | null | undefined) => Promise<string | null>

/**
 * Audit attachment seam (issue 44): redact secrets, hash clientIp with today's
 * salt, and omit the raw address from the stored shape. `createIpHash` stays
 * the hash implementation; this module owns when hashed_ip is attached.
 */
export async function prepareAuthEventForStore(
  input: Omit<AuthEventInput, 'onAlert'>,
  hash: AuthEventHashIp = hashIp,
): Promise<StoredAuthEvent> {
  const { principal, clientIp, type, requestId, outcome, reason } = input
  return {
    type,
    principalKey: principalKey(principal),
    requestId,
    outcome,
    reason,
    hashedIp: await hash(clientIp),
    timestamp: new Date(Date.now()), // Use Date.now() to allow test mocking
  }
}

/**
 * Auth-event module seam: redact sensitive fields, persist the event, and
 * (on failure) evaluate the 5-in-10-minute alert threshold. Callers do not
 * need a separate checkFailureRate hop.
 */
export async function recordAuthEvent(input: AuthEventInput): Promise<RecordAuthEventResult> {
  const { onAlert, ...rest } = input
  const safeEvent = await prepareAuthEventForStore(rest)

  await getDb().insert(authEvents).values(safeEvent)

  if (rest.outcome !== 'failure') return { alerted: false }
  const alerted = await evaluateFailureRate(rest.principal, { onAlert })
  return { alerted }
}

function mapAuthEventRow(row: {
  id: number
  type: string
  principalKey: string
  requestId: string
  outcome: string
  reason: string | null
  hashedIp: string | null
  timestamp: Date
}): AuthEvent {
  return {
    id: row.id,
    type: row.type as AuthEventType,
    principalKey: row.principalKey,
    requestId: row.requestId,
    outcome: row.outcome as 'success' | 'failure',
    reason: row.reason ?? undefined,
    ...(row.hashedIp ? { hashedIp: row.hashedIp } : {}),
    timestamp: row.timestamp,
  }
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

  return results.map(mapAuthEventRow)
}

/**
 * Recent auth events for a Principal (HTTP list seam for `/auth/me/events`).
 * Callers do not learn the table shape or ordering rules.
 */
export async function listAuthEventsForPrincipal(
  principal: PrincipalId,
  options: { limit?: number; offset?: number } = {},
): Promise<AuthEvent[]> {
  const key = principalKey(principal)
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const offset = Math.max(options.offset ?? 0, 0)

  const results = await getDb()
    .select()
    .from(authEvents)
    .where(sql`${authEvents.principalKey} = ${key}`)
    .orderBy(desc(authEvents.timestamp))
    .limit(limit)
    .offset(offset)

  return results.map(mapAuthEventRow)
}

/**
 * Internal: evaluate the failure-rate threshold after a failure is recorded.
 * Kept off the public interface so callers use recordAuthEvent's deeper seam.
 */
async function evaluateFailureRate(
  principal: PrincipalId,
  options: { onAlert?: (alert: FailureAlert) => void } = {},
): Promise<boolean> {
  const key = principalKey(principal)
  const windowMinutes = 10
  const threshold = 5

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
