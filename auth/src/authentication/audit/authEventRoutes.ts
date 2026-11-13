import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import { listAuthEventsForPrincipal } from './authEvents.js'

/**
 * Feature 3: Authentication Event Log Query
 *
 * Allows users to view their own authentication events through the authEvents
 * module seam (not a raw table read).
 */
export function registerAuthEventRoutes(app: Hono): void {
  app.get('/auth/me/events', guarded({ credential: 'session' }, async ({ c, user }) => {
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
    const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0)

    const events = await listAuthEventsForPrincipal(
      { iss: user.iss, sub: user.sub },
      { limit, offset },
    )

    return c.json({
      events: events.map((e) => ({
        id: e.id,
        action: e.type,
        outcome: e.outcome,
        timestamp: Math.floor((e.timestamp?.getTime() ?? Date.now()) / 1000),
        requestId: e.requestId,
        message: e.reason || `${e.type} ${e.outcome}`,
      })),
      limit,
      offset,
    })
  }))
}
