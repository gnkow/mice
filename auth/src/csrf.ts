import type { MiddlewareHandler } from 'hono'
import { env } from './env.js'
import { actorFromUser, appendAudit } from './audit.js'
import { getSession } from './session.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function originAllowed(origin: string, headers: Headers): boolean {
  if (origin === env.publicWebOrigin) return true
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  const own = [headers.get('x-forwarded-host'), headers.get('host')]
  return own.some((h) => h?.split(',')[0]?.trim() === host)
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
 * same-origin. Bearer (PAT) requests have no session cookie and are never affected.
 */
export const sameOriginGuard: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method) || !isCrossSite(c.req.raw.headers)) return next()
  const session = await getSession(c)
  if (!session) return next()
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
