import type { Hono } from 'hono'
import { declareReason } from './auditReason.js'
import { guarded } from './authentication/index.js'

/** Lets a client that cannot send X-Mice-Reason (the oxen binary) state a reason for its next mutations. */
export function registerReasonRoutes(app: Hono): void {
  app.post('/auth/reason', guarded({ allowScoped: true, body: 'json', invalidBody: 'Invalid JSON body' }, ({ c, user, body }) => {
    const r = declareReason(
      user,
      body.reason,
      typeof body.ttlSec === 'number' ? body.ttlSec : undefined,
      typeof body.category === 'string' ? body.category : undefined,
      typeof body.changeControlId === 'string'
        ? body.changeControlId
        : typeof body.change_control_id === 'string'
          ? body.change_control_id
          : undefined,
    )
    if (!r.ok) {
      const code = r.error.includes('category') ? 'reason_category_invalid' : 'reason_too_short'
      return c.json({ error: r.error, code }, 400)
    }
    return c.json({ ok: true, expiresAt: r.expiresAt })
  }))
}
