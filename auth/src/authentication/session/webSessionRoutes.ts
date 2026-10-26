import { and, eq, gt } from 'drizzle-orm'
import type { Hono } from 'hono'
import { getDb } from '../../db/database.js'
import { webSessions } from '../../db/schema.js'
import { env } from '../../env.js'
import { guarded } from './routeGuard.js'

const nowSec = () => Math.floor(Date.now() / 1000)

export function registerWebSessionRoutes(app: Hono) {
  app.get('/auth/sessions/web', guarded({ credential: 'session' }, async ({ c, user }) => {
    const now = nowSec()
    const sessions = await getDb()
      .select({
        id: webSessions.idHash,
        lastActive: webSessions.lastActive,
        sessionStart: webSessions.sessionStart,
      })
      .from(webSessions)
      .where(
        and(
          eq(webSessions.principalId, user.principalId!),
          // Not expired by absolute TTL
          gt(webSessions.sessionStart, now - env.sessionTtlSec),
          // Not expired by idle timeout (if enabled)
          env.sessionIdleSec > 0
            ? gt(webSessions.lastActive, now - env.sessionIdleSec)
            : undefined
        )
      )
      .orderBy(webSessions.sessionStart)
    
    return c.json({
      sessions: sessions.map(s => ({
        id: s.id,
        lastActive: s.lastActive,
        sessionStart: s.sessionStart,
      })),
    })
  }))

  app.delete('/auth/sessions/web/:id', guarded({ credential: 'session' }, async ({ c, user }) => {
    const targetHash = c.req.param('id')
    
    // First check if this session belongs to the user
    const [session] = await getDb()
      .select({ principalId: webSessions.principalId })
      .from(webSessions)
      .where(eq(webSessions.idHash, targetHash))
    
    if (!session || session.principalId !== user.principalId) {
      return c.json({ error: 'Session not found' }, 404)
    }
    
    // Delete the session
    await getDb().delete(webSessions).where(eq(webSessions.idHash, targetHash))
    
    return c.json({ ok: true })
  }))
}
