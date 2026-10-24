import type { Context } from 'hono'
import { offboard } from './offboarding.js'
import { clearSessionCookie, getSession } from './session.js'

/**
 * "Sign out everywhere": Session-only (a PAT cannot call it). Cross-origin
 * writes are rejected earlier by the global guards.
 */
export async function signOutEverywhere(c: Context): Promise<Response> {
  const session = await getSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  let includePats = false
  try {
    const body = (await c.req.json()) as { includePats?: unknown }
    includePats = body.includePats === true
  } catch {
    // empty body means defaults
  }
  offboard(session, {
    scope: includePats ? 'all' : 'sessions',
    cause: 'self-service',
    method: c.req.method,
    path: c.req.path,
    message: includePats ? 'Signed out everywhere and revoked PATs' : 'Signed out everywhere',
    detail: { includePats },
  })
  clearSessionCookie(c)
  return c.json({ ok: true })
}
