import type { Hono } from 'hono'
import { actorFromUser } from './audit.js'
import { offboard } from './offboarding.js'
import { callerVia } from './requireAuth.js'
import { guarded } from './routeGuard.js'

/** Instance-admin revocation of every credential a Principal holds. */
export function registerRevocationRoutes(app: Hono): void {
  app.post(
    '/auth/instance/revoke-sessions',
    guarded({ body: { required: ['sub', 'iss'] } }, ({ c, user, body }) => {
      const target = { sub: body.sub as string, iss: body.iss as string }
      const result = offboard(target, {
        scope: 'all',
        cause: 'admin-revocation',
        actor: actorFromUser(user),
        via: callerVia(c, 'session'),
        method: c.req.method,
        path: c.req.path,
        message: `Revoked all sessions of ${target.sub}`,
        detail: { target },
      })
      if (!result.ok) return c.json({ error: result.error }, 403)
      return c.json({ ok: true })
    }),
  )
}
