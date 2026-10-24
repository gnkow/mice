import type { Context } from 'hono'
import { actorFromUser, appendAudit } from './audit.js'
import { revokeSessionsFor, revokeSessionsOnlyFor } from './credentialRevocation.js'
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
  if (includePats) revokeSessionsFor(session)
  else revokeSessionsOnlyFor(session)
  appendAudit({
    actor: actorFromUser(session),
    via: 'session',
    method: c.req.method,
    path: c.req.path,
    status: 200,
    action: 'session.revoke',
    message: includePats
      ? 'Signed out everywhere and revoked PATs'
      : 'Signed out everywhere',
    detail: { source: 'self-service', includePats },
  })
  clearSessionCookie(c)
  return c.json({ ok: true })
}
