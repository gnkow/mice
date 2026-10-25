import type { Hono } from 'hono'
import { declareReason } from './auditReason.js'
import { guarded } from './routeGuard.js'

/** Lets a client that cannot send X-Mice-Reason (the oxen binary) state a reason for its next mutations. */
export function registerReasonRoutes(app: Hono): void {
  app.post('/auth/reason', guarded({ allowScoped: true, body: 'json', invalidBody: 'Invalid JSON body' }, ({ c, user, body }) => {
    const r = declareReason(user, body.reason, typeof body.ttlSec === 'number' ? body.ttlSec : undefined)
    if (!r.ok) return c.json({ error: r.error, code: 'reason_too_short' }, 400)
    return c.json({ ok: true, expiresAt: r.expiresAt })
  }))
}
