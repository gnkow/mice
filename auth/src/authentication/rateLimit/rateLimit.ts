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

/**
 * Check rate limit for a key (IP or Principal).
 * Returns error=true when storage is unavailable (fail-closed).
 * 
 * @param limitKey - "ip:<hashed_ip>" or "principal:<iss|sub>"
 * @param config - Rate limit configuration
 */
export async function checkRateLimit(
  limitKey: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const windowStart = new Date(Date.now() - config.windowMs)
    
    // Count requests in the window
    const recentRequests = await getDb()
      .select({ id: rateLimits.id })
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.limitKey, limitKey),
          eq(rateLimits.endpoint, config.endpoint),
          gte(rateLimits.requestedAt, windowStart)
        )
      )
    
    const count = recentRequests.length
    
    if (count >= config.limit) {
      return {
        allowed: false,
        count,
        limit: config.limit,
        windowSeconds: Math.floor(config.windowMs / 1000),
        retryAfter: Math.floor(config.windowMs / 1000),
      }
    }
    
    return { allowed: true, count, limit: config.limit }
  } catch (error) {
    // Fail-closed: storage unavailable = deny request
    return {
      error: true,
      message: error instanceof Error ? error.message : 'Rate limit storage unavailable',
    }
  }
}

/**
 * Record a request for rate limiting.
 * Fails silently if storage is unavailable (check happens before record).
 */
export async function recordRateLimitRequest(
  limitKey: string,
  endpoint: string
): Promise<void> {
  try {
    await getDb().insert(rateLimits).values({
      limitKey,
      endpoint,
      requestedAt: new Date(),
    })
  } catch (error) {
    // Log but don't throw - the check already happened
    console.error('Failed to record rate limit request:', error)
  }
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
