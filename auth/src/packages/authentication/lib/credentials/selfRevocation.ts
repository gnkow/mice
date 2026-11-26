import type { Context } from 'hono'
import { offboard } from './offboarding.js'
import { clearSessionCookie, getSession } from '../session/session.js'

/**
 * "Sign out everywhere": Session-only (a CLI credential cannot call it). Cross-origin
 * writes are rejected earlier by the global guards. Also revokes the caller's CLI credentials.
 */
export async function signOutEverywhere(c: Context): Promise<Response> {
  const session = await getSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const result = await offboard(session, {
    scope: 'all',
    cause: 'self-service',
    strictAudit: true,
    method: c.req.method,
    path: c.req.path,
    message: 'Signed out everywhere',
    detail: { source: 'self-service' },
  })
  if (!result.ok) {
    return c.json({ error: 'Audit system unavailable - revocation blocked' }, 503)
  }
  clearSessionCookie(c)
  return c.json({ ok: true })
}
