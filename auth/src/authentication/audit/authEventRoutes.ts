import { eq, desc } from 'drizzle-orm'
import type { Hono } from 'hono'
import { getDb } from '../../db/database.js'
import { authEvents } from '../../db/schema.js'
import { guarded } from '../session/routeGuard.js'
import { principalKey } from '../session/principal.js'

/**
 * Feature 3: Authentication Event Log Query
 * 
 * Allows users to view their own authentication events.
 */
export function registerAuthEventRoutes(app: Hono): void {
  app.get('/auth/me/events', guarded({ credential: 'session' }, async ({ c, user }) => {
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
    const offset = Math.max(parseInt(c.req.query('offset') || '0'), 0)

    const key = principalKey({ iss: user.iss, sub: user.sub })

    const events = await getDb()
      .select({
        id: authEvents.id,
        type: authEvents.type,
        outcome: authEvents.outcome,
        reason: authEvents.reason,
        timestamp: authEvents.timestamp,
        requestId: authEvents.requestId,
      })
      .from(authEvents)
      .where(eq(authEvents.principalKey, key))
      .orderBy(desc(authEvents.timestamp))
      .limit(limit)
      .offset(offset)

    return c.json({
      events: events.map(e => ({
        id: e.id,
        action: e.type,
        outcome: e.outcome,
        timestamp: Math.floor(e.timestamp.getTime() / 1000),
        requestId: e.requestId,
        message: e.reason || `${e.type} ${e.outcome}`,
      })),
      limit,
      offset,
    })
  }))
}
