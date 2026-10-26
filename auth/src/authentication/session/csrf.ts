import type { MiddlewareHandler } from 'hono'
import { env } from '../../env.js'
import { actorFromUser, appendAudit } from '../../audit.js'
import { getSession } from './session.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function originAllowed(origin: string, headers: Headers): boolean {
  if (origin === env.publicWebOrigin) return true
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
    const pubHostname = new URL(env.publicWebOrigin).hostname
    if (pubHostname === 'localhost' || pubHostname === '127.0.0.1') return true
  }
  
  return false
}

/** True when a browser-attested request did not originate from our own site. */
export function isCrossSite(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site')
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = headers.get('origin')
  if (origin) return !originAllowed(origin, headers)
  // No browser signals: not a cross-site browser request (CLI, curl).
  return false
}

/**
 * CSRF defence for cookie sessions: unsafe requests carrying a valid Session cookie must be
 * same-origin and must provide an Origin header. Bearer (PAT) requests have no session cookie and are never affected.
 */
export const sameOriginGuard: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next()
  
  const session = await getSession(c)
  if (!session) return next()
  
  // Session-authenticated mutations must have an Origin header
  const origin = c.req.raw.headers.get('origin')
  if (!origin) {
    await appendAudit({
      actor: actorFromUser(session),
      via: 'session',
      method: c.req.method,
      path: c.req.path,
      status: 403,
      action: 'request.missing_origin',
    })
    return c.json(
      {
        status: 'error',
        status_message: 'forbidden',
        error: { detail: 'Origin header required' },
      },
      403,
    )
  }
  
  // Check if the origin is allowed
  if (isCrossSite(c.req.raw.headers)) {
    await appendAudit({
      actor: actorFromUser(session),
      via: 'session',
      method: c.req.method,
      path: c.req.path,
      status: 403,
      action: 'request.cross_site_rejected',
    })
    return c.json(
      {
        status: 'error',
        status_message: 'forbidden',
        error: { detail: 'Cross-site request rejected' },
      },
      403,
    )
  }
  
  return next()
}
