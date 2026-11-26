import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { getDb } from '../../../../db/database.js'
import { webSessions } from '../../../../db/schema.js'
import { env } from '../../../shared/index.js'
import { requireAuditChange } from '../../../audit/change.js'
import type { AuditDep } from '../../../shared/index.js'
import { guarded } from './routeGuard.js'
import { decideSessionLiveness } from './sessionLiveness.js'
import { readSessionCookie } from './session.js'

const nowSec = () => Math.floor(Date.now() / 1000)
const hashId = (id: string) => createHash('sha256').update(id).digest('hex')

export function registerWebSessionRoutes(app: Hono, { audit }: AuditDep = { audit: async () => {} }) {
  app.get('/auth/sessions/web', guarded({ credential: 'session' }, async ({ c, user }) => {
    const now = nowSec()
    const rawCookie = await readSessionCookie(c)
    const currentHash = rawCookie ? hashId(rawCookie) : null
    const rows = await getDb()
      .select({
        id: webSessions.idHash,
        lastActive: webSessions.lastActive,
        sessionStart: webSessions.sessionStart,
      })
      .from(webSessions)
      .where(eq(webSessions.principalId, user.principalId!))
      .orderBy(webSessions.sessionStart)

    const sessions = rows.filter((s) =>
      decideSessionLiveness({
        now,
        sessionStart: s.sessionStart,
        lastActive: s.lastActive,
        ttlSec: env.sessionTtlSec,
        idleSec: env.sessionIdleSec,
      }).alive,
    )

    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        lastActive: s.lastActive,
        sessionStart: s.sessionStart,
        current: currentHash !== null && s.id === currentHash,
        expiresAt: s.sessionStart + env.sessionTtlSec,
        ...(env.sessionIdleSec > 0
          ? { idleExpiresAt: s.lastActive + env.sessionIdleSec }
          : {}),
      })),
    })
  }))

  app.delete('/auth/sessions/web/:id', guarded({ credential: 'session' }, async ({ c, user }) => {
    const targetHash = c.req.param('id')

    // First check if this session belongs to the user
    const [session] = await getDb()
      .select({
        principalId: webSessions.principalId,
        sessionStart: webSessions.sessionStart,
      })
      .from(webSessions)
      .where(eq(webSessions.idHash, targetHash))

    if (!session || session.principalId !== user.principalId) {
      return c.json({ error: 'Session not found' }, 404)
    }

    // Delete the session
    await getDb().delete(webSessions).where(eq(webSessions.idHash, targetHash))
    await audit(c, user, 'session', {
      action: 'session.revoke',
      change: requireAuditChange(
        { session_id_hash: targetHash, principal_id: session.principalId, session_start: session.sessionStart },
        null,
      ),
      message: 'Revoked a web browser session',
      detail: { session_id_hash: targetHash },
    })

    return c.json({ ok: true })
  }))
}
