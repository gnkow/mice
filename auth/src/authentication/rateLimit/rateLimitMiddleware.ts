import type { Context } from 'hono'
import type { SessionUser } from '../session/session.js'
import { principalKey } from '../session/principal.js'
import {
  checkRateLimit,
  recordRateLimitRequest,
  ipRateLimitKey,
  principalRateLimitKey,
  type RateLimitConfig,
  type RateLimitResult,
} from './rateLimit.js'

/**
 * Rate Limit Middleware (Ticket 24, U22)
 * 
 * Guards routes with rate limiting. Returns 429 when limit exceeded,
 * 503 when storage is unavailable (fail-closed).
 * 
 * Usage:
 * ```
 * app.post('/auth/oidc/callback', async (c) => {
 *   const ip = c.req.header('x-forwarded-for') ?? c.req.raw.headers.get('cf-connecting-ip') ?? 'unknown'
 *   const limitResult = await rateLimitByIp(ip, RATE_LIMIT_CONFIG.login)
 *   if (!limitResult.allowed) {
 *     return handleRateLimitError(c, limitResult)
 *   }
 *   // ... rest of handler
 * })
 * ```
 */

/**
 * Check rate limit for an IP address.
 * Call this at the start of a route handler.
 */
export async function rateLimitByIp(
  ip: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const limitKey = await ipRateLimitKey(ip)
  const result = await checkRateLimit(limitKey, config)
  if ('error' in result || !result.allowed) return result

  const recorded = await recordRateLimitRequest(limitKey, config.endpoint)
  if (!recorded) return { error: true, message: 'Rate limit storage unavailable' }
  return result
}

/**
 * Check rate limit for a Principal (authenticated user).
 * Call this at the start of a route handler.
 */
export async function rateLimitByPrincipal(
  user: SessionUser,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const key = principalKey(user)
  const limitKey = principalRateLimitKey(key)
  const result = await checkRateLimit(limitKey, config)
  if ('error' in result || !result.allowed) return result

  const recorded = await recordRateLimitRequest(limitKey, config.endpoint)
  if (!recorded) return { error: true, message: 'Rate limit storage unavailable' }
  return result
}

/**
 * Handle rate limit errors by returning appropriate HTTP responses.
 * 
 * - 429 Too Many Requests: rate limit exceeded
 * - 503 Service Unavailable: storage unavailable (fail-closed)
 */
export function handleRateLimitError(c: Context, result: RateLimitResult): Response {
  if ('error' in result) {
    // Storage unavailable - fail closed
    console.error('Rate limit storage failure:', result.message)
    return c.json(
      {
        error: 'Service temporarily unavailable',
        detail: 'Rate limiting service unavailable',
      },
      503
    )
  }
  
  if (!result.allowed) {
    // Rate limit exceeded
    const retryAfter = result.retryAfter
    return c.json(
      {
        error: 'Rate limit exceeded',
        detail: `Maximum ${result.limit} requests per ${result.windowSeconds}s`,
        retry_after: retryAfter,
      },
      429,
      {
        'Retry-After': String(retryAfter),
      }
    )
  }
  
  // This shouldn't happen if used correctly
  throw new Error('handleRateLimitError called with allowed result')
}

/** The 429 or 503 response, or null when the request may proceed. */
export async function enforceIpRateLimit(c: Context, config: RateLimitConfig): Promise<Response | null> {
  const result = await rateLimitByIp(getClientIp(c), config)
  if ('error' in result || !result.allowed) return handleRateLimitError(c, result)
  return null
}

export function getClientIp(c: Context): string {
  // Try X-Forwarded-For first (standard)
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    // X-Forwarded-For can be a comma-separated list, take the first (client)
    return forwarded.split(',')[0].trim()
  }
  
  // Try Cloudflare's header
  const cfIp = c.req.header('cf-connecting-ip')
  if (cfIp) {
    return cfIp
  }
  
  // Fallback (should not happen in production behind a proxy)
  return 'unknown'
}
