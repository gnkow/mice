import { eq, desc } from 'drizzle-orm'
import type { Hono } from 'hono'
import { getDb } from '../../db/database.js'
import { authEvents } from '../../db/schema.js'
import { guarded } from '../session/routeGuard.js'

/**
 * Feature 3: Authentication Event Log Query
 * 
 * Allows users to view their own authentication events.
 */
export function registerAuthEventRoutes(app: Hono): void {
  app.get('/auth/me/events', guarded({ credential: 'session' }, async ({ c, user }) => {
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
    const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0)

    const events = await getDb()
      .select({
        id: authEvents.id,
        action: authEvents.action,
        timestamp: authEvents.timestamp,
        requestId: authEvents.requestId,
        message: authEvents.message,
      })
      .from(authEvents)
      .where(eq(authEvents.principalId, user.principalId!))
      .orderBy(desc(authEvents.timestamp))
      .limit(limit)
      .offset(offset)

    return c.json({
      events: events.map(e => ({
        id: e.id,
        action: e.action,
        timestamp: e.timestamp,
        requestId: e.requestId,
        message: e.message,
      })),
      limit,
      offset,
    })
  }))
}
