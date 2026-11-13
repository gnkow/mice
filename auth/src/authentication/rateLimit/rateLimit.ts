import { getDb } from '../../db/database.js'
import { rateLimits } from '../../db/schema.js'
import { eq, and, gte, sql } from 'drizzle-orm'
import { hashIp } from '../../ipHash.js'

/**
 * General Rate Limiting Infrastructure (Ticket 24, U22)
 * 
 * Shared rate limiters across BFF instances using Postgres storage.
 * Fail-closed: if storage is unreachable, return 503 (not fail-open).
 * 
 * Per-IP limits:
 * - login callback: 10/min
 * - device flow initiation: 5/min
 * - token refresh: 20/min
 * 
 * Per-Principal limits:
 * - device approval: 5/10min (already implemented in deviceApprovalRateLimit.ts)
 * - token minting: 10/hour
 * 
 * Related:
 * - .scratch/authentication/issues/24-rate-limiter-fail-closed.md
 * - Round 8 decision U22
 */

export type RateLimitConfig = {
  /** Maximum number of requests allowed */
  limit: number
  /** Window size in milliseconds */
  windowMs: number
  /** Endpoint identifier */
  endpoint: string
}

export type RateLimitResult =
  | { allowed: true; count: number; limit: number }
  | { allowed: false; count: number; limit: number; windowSeconds: number; retryAfter: number }
  | { error: true; message: string }

/** Counter store port: production uses Postgres; tests inject failing or in-memory adapters. */
export type RateLimitStore = {
  countInWindow(limitKey: string, endpoint: string, windowStart: Date): Promise<number>
  record(limitKey: string, endpoint: string, at: Date): Promise<void>
}

export type ConsumeRateLimitDeps = {
  store?: RateLimitStore
  now?: () => number
}

/**
 * Configuration for standard authentication endpoints.
 */
export const RATE_LIMIT_CONFIG = {
  /** POST /auth/oidc/callback - login callback */
  login: { limit: 10, windowMs: 60_000, endpoint: 'login' },
  /** POST /auth/cli/device/start - device flow initiation */
  deviceFlow: { limit: 5, windowMs: 60_000, endpoint: 'device_flow' },
  /** POST /auth/refresh - token refresh */
  refresh: { limit: 20, windowMs: 60_000, endpoint: 'refresh' },
  /** POST /auth/cli/token - token minting */
  tokenMint: { limit: 10, windowMs: 3600_000, endpoint: 'token_mint' },
} as const

const postgresRateLimitStore: RateLimitStore = {
  async countInWindow(limitKey, endpoint, windowStart) {
    const recentRequests = await getDb()
      .select({ id: rateLimits.id })
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.limitKey, limitKey),
          eq(rateLimits.endpoint, endpoint),
          gte(rateLimits.requestedAt, windowStart),
        ),
      )
    return recentRequests.length
  },
  async record(limitKey, endpoint, at) {
    await getDb().insert(rateLimits).values({
      limitKey,
      endpoint,
      requestedAt: at,
    })
  },
}

/**
 * Counter module seam: decide allow/deny and, when allowed, record the hit.
 * Callers learn one interface — check + write stay behind the implementation.
 *
 * @param limitKey - "ip:<hashed_ip>" or "principal:<iss|sub>"
 */
export async function consumeRateLimit(
  limitKey: string,
  config: RateLimitConfig,
  deps: ConsumeRateLimitDeps = {},
): Promise<RateLimitResult> {
  const store = deps.store ?? postgresRateLimitStore
  const now = deps.now ?? Date.now

  let count: number
  try {
    count = await store.countInWindow(
      limitKey,
      config.endpoint,
      new Date(now() - config.windowMs),
    )
  } catch (error) {
    return {
      error: true,
      message: error instanceof Error ? error.message : 'Rate limit storage unavailable',
    }
  }

  if (count >= config.limit) {
    return {
      allowed: false,
      count,
      limit: config.limit,
      windowSeconds: Math.floor(config.windowMs / 1000),
      retryAfter: Math.floor(config.windowMs / 1000),
    }
  }

  try {
    await store.record(limitKey, config.endpoint, new Date(now()))
  } catch (error) {
    console.error('Failed to record rate limit request:', error)
    return {
      error: true,
      message: error instanceof Error ? error.message : 'Rate limit storage unavailable',
    }
  }

  return { allowed: true, count, limit: config.limit }
}

/**
 * Build a rate limit key for an IP address.
 * Uses hashed IP (same as audit logging) for privacy.
 */
export async function ipRateLimitKey(ip: string): Promise<string> {
  const hashed = await hashIp(ip)
  return `ip:${hashed ?? 'unknown'}`
}

/**
 * Build a rate limit key for a Principal.
 */
export function principalRateLimitKey(principalKey: string): string {
  return `principal:${principalKey}`
}

/**
 * Clean up old rate limit records (for maintenance jobs).
 * Deletes records older than the specified age.
 */
export async function cleanupOldRateLimitRecords(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs)
  
  const result = await getDb()
    .delete(rateLimits)
    .where(sql`${rateLimits.requestedAt} < ${cutoff}`)
  
  return result.rowCount ?? 0
}
