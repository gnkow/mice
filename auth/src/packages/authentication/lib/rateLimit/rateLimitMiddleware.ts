import type { Context } from 'hono'
import type { SessionUser } from '../session/session.js'
import { principalKey } from '../session/principal.js'
import {
  consumeRateLimit,
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
 *   const limited = await enforceIpRateLimit(c, RATE_LIMIT_CONFIG.login)
 *   if (limited) return limited
 *   // ... rest of handler
 * })
 * ```
 */

/** Consume one IP-keyed slot through the counter module seam. */
export async function rateLimitByIp(
  ip: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  return consumeRateLimit(await ipRateLimitKey(ip), config)
}

/** Consume one Principal-keyed slot through the counter module seam. */
export async function rateLimitByPrincipal(
  user: SessionUser,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const limitKey = principalRateLimitKey(principalKey(user))
  return consumeRateLimit(limitKey, config)
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
