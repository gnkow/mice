import type { Hono } from 'hono'
import { actorFromUser } from './audit.js'
import { preparePrincipal } from './authz.js'
import { offboard } from './offboarding.js'
import { authenticateUser, callerVia } from './requireAuth.js'

/** Instance-admin revocation of every credential a Principal holds. */
export function registerRevocationRoutes(app: Hono): void {
  app.post('/auth/instance/revoke-sessions', async (c) => {
    const session = await authenticateUser(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    let body: { sub?: string; iss?: string }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.sub || !body.iss) {
      return c.json({ error: 'sub and iss required' }, 400)
    }
    const target = { sub: body.sub, iss: body.iss }
    const result = offboard(target, {
      scope: 'all',
      cause: 'admin-revocation',
      actor: actorFromUser(session),
      via: callerVia(c, 'session'),
      method: c.req.method,
      path: c.req.path,
      message: `Revoked all sessions of ${target.sub}`,
      detail: { target },
    })
    if (!result.ok) return c.json({ error: result.error }, 403)
    return c.json({ ok: true })
  })
}
