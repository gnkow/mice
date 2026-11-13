import type { MiddlewareHandler } from 'hono'
import { env } from '../../env.js'
import { actorFromUser, appendAudit } from '../../audit.js'
import { getSession } from './session.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type CookieCsrfDecision =
  | { allow: true }
  | {
      allow: false
      action: 'request.missing_origin' | 'request.cross_site_rejected'
      detail: string
    }

function originAllowed(origin: string, headers: Headers, publicWebOrigin: string): boolean {
  if (origin === publicWebOrigin) return true
  let host: string
  let hostname: string
  try {
    const url = new URL(origin)
    host = url.host
    hostname = url.hostname
  } catch {
    return false
  }
  const own = [headers.get('x-forwarded-host'), headers.get('host')]
  if (own.some((h) => h?.split(',')[0]?.trim() === host)) return true

  // In development, allow any localhost port to match
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const pubHostname = new URL(publicWebOrigin).hostname
    if (pubHostname === 'localhost' || pubHostname === '127.0.0.1') return true
  }

  return false
}

/** True when a browser-attested request did not originate from our own site. */
export function isCrossSite(headers: Headers, publicWebOrigin = env.publicWebOrigin): boolean {
  const site = headers.get('sec-fetch-site')
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = headers.get('origin')
  if (origin) return !originAllowed(origin, headers, publicWebOrigin)
  // No browser signals: not a cross-site browser request (CLI, curl).
  return false
}

/**
 * Cookie-session CSRF decision: unsafe methods with a Session must be same-origin
 * and must send Origin. Bearer (no session) is never affected.
 */
export function evaluateCookieCsrf(input: {
  method: string
  hasSession: boolean
  headers: Headers
  publicWebOrigin: string
}): CookieCsrfDecision {
  if (SAFE_METHODS.has(input.method) || !input.hasSession) return { allow: true }

  if (!input.headers.get('origin')) {
    return {
      allow: false,
      action: 'request.missing_origin',
      detail: 'Origin header required',
    }
  }

  if (isCrossSite(input.headers, input.publicWebOrigin)) {
    return {
      allow: false,
      action: 'request.cross_site_rejected',
      detail: 'Cross-site request rejected',
    }
  }

  return { allow: true }
}

/**
 * CSRF defence for cookie sessions: thin Hono adapter over {@link evaluateCookieCsrf}.
 */
export const sameOriginGuard: MiddlewareHandler = async (c, next) => {
  const session = SAFE_METHODS.has(c.req.method) ? null : await getSession(c)
  const decision = evaluateCookieCsrf({
    method: c.req.method,
    hasSession: !!session,
    headers: c.req.raw.headers,
    publicWebOrigin: env.publicWebOrigin,
  })
  if (decision.allow) return next()

  await appendAudit({
    actor: actorFromUser(session!),
    via: 'session',
    method: c.req.method,
    path: c.req.path,
    status: 403,
    action: decision.action,
  })
  return c.json(
    {
      status: 'error',
      status_message: 'forbidden',
      error: { detail: decision.detail },
    },
    403,
  )
}
