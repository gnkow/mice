import type { Hono } from 'hono'
import { actorFromUser, appendAudit } from './audit.js'
import { env } from './env.js'
import {
  connectDesktopSession,
  createDesktopSession,
  destroyDesktopSession,
  listDesktopSessions,
  markSessionDisconnect,
  parseCreateBody,
  publicSession,
  sessionsAuditRetentionPolicy,
  stopDesktopSession,
} from './sessions.js'
import { peekConnectTicket } from './sessionsConnect.js'
import { getSessionRecord } from './sessionsStore.js'
import { listSessionTemplates } from './sessionsTemplates.js'
import { guarded } from './authentication/session/routeGuard.js'

export function registerSessionRoutes(app: Hono) {
  app.get('/auth/sessions/templates', guarded({ allowScoped: true }, async ({ c }) => {
    if (!env.sessionsEnabled) {
      return c.json({ error: 'Sessions disabled' }, 503)
    }
    return c.json({ templates: listSessionTemplates() })
  }))

  app.get('/auth/sessions/retention', guarded({ allowScoped: true }, async ({ c }) => {
    return c.json(sessionsAuditRetentionPolicy())
  }))

  app.post('/auth/sessions', guarded({ allowScoped: true }, async ({ c, user, via, readBody }) => {
    if (!env.sessionsEnabled) {
      return c.json({ error: 'Sessions disabled' }, 503)
    }
    const read = await readBody('json', 'Invalid JSON')
    if (!read.ok) return read.res
    const parsed = parseCreateBody(read.body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      const session = await createDesktopSession(
        user,
        via,
        parsed,
      )
      return c.json({ session: publicSession(session) }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'create failed'
      const explicit = err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 0
      const status = explicit || (/Forbidden|requires repository/i.test(msg) ? 403 : 400)
      return c.json({ error: msg }, status as 400 | 403 | 404 | 409 | 503)
    }
  }))

  app.get('/auth/sessions', guarded({ allowScoped: true }, async ({ c, user }) => {
    const all = c.req.query('all') === '1' || c.req.query('all') === 'true'
    const workspaceId = c.req.query('workspace_id') || undefined
    const namespace = c.req.query('namespace') || undefined
    const repo = c.req.query('repo') || undefined
    const sessions = await listDesktopSessions({ user, all, workspaceId, namespace, repo })
    return c.json({ sessions })
  }))

  app.get('/auth/sessions/:id', guarded({ allowScoped: true }, async ({ c, user, deny }) => {
    const row = await getSessionRecord(c.req.param('id'))
    if (!row || row.status === 'destroyed') {
      return c.json({ error: 'Not found' }, 404)
    }
    const { authorizeSessionAccess } = await import('./sessions.js')
    const denied = deny(await authorizeSessionAccess(user, row, 'read'))
    if (denied) return denied
    return c.json({ session: publicSession(row) })
  }))

  app.post('/auth/sessions/:id/connect', guarded({ allowScoped: true }, async ({ c, user, via }) => {
    try {
      const result = await connectDesktopSession(
        user,
        via,
        c.req.param('id'),
      )
      return c.json(result)
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 400
      const msg = err instanceof Error ? err.message : 'connect failed'
      return c.json({ error: msg }, status as 400 | 403 | 404 | 409)
    }
  }))

  app.post('/auth/sessions/:id/disconnect', guarded({ allowScoped: true }, async ({ c, user, via }) => {
    const updated = await markSessionDisconnect(
      user,
      via,
      c.req.param('id'),
    )
    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json({ session: updated })
  }))

  app.post('/auth/sessions/:id/retry', guarded({ allowScoped: true }, async ({ c, user, via }) => {
    try {
      const { retryDesktopSession } = await import('./sessions.js')
      const session = await retryDesktopSession(
        user,
        via,
        c.req.param('id'),
      )
      return c.json({ session })
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 400
      const msg = err instanceof Error ? err.message : 'retry failed'
      return c.json({ error: msg }, status as 400 | 403 | 404 | 409)
    }
  }))

  app.put('/auth/sessions/:id/mounts', guarded({ allowScoped: true, body: 'json', invalidBody: 'Invalid JSON' }, async ({ c, user, via, body }) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid body' }, 400)
    const { parseMountsList, updateSessionMounts } = await import('./sessions.js')
    const parsed = parseMountsList((body as { mounts?: unknown }).mounts)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      const session = await updateSessionMounts(user, via, c.req.param('id'), parsed)
      return c.json({ session })
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 400
      const msg = err instanceof Error ? err.message : 'mount update failed'
      const holder = err && typeof err === 'object' && 'holder' in err ? (err as { holder: unknown }).holder : undefined
      return c.json({ error: msg, ...(holder ? { holder } : {}) }, status as 400 | 403 | 404 | 409 | 423 | 504)
    }
  }))

  app.post('/auth/sessions/:id/remount', guarded({ allowScoped: true, body: 'optional' }, async ({ c, user, via, body }) => {
    try {
      const { remountDesktopSession } = await import('./sessions.js')
      const session = await remountDesktopSession(user, via, c.req.param('id'), {
        ...(typeof body.workspace_id === 'string' ? { workspace_id: body.workspace_id } : {}),
        ...(typeof body.mount_path === 'string' ? { mount_path: body.mount_path } : {}),
      })
      return c.json({ session })
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 400
      const msg = err instanceof Error ? err.message : 'remount failed'
      const holder = err && typeof err === 'object' && 'holder' in err ? (err as { holder: unknown }).holder : undefined
      return c.json({ error: msg, ...(holder ? { holder } : {}) }, status as 400 | 403 | 404 | 409 | 423)
    }
  }))

  app.post('/auth/sessions/:id/stop', guarded({ allowScoped: true }, async ({ c, user, via }) => {
    try {
      const session = await stopDesktopSession(
        user,
        via,
        c.req.param('id'),
      )
      return c.json({ session })
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 400
      const msg = err instanceof Error ? err.message : 'stop failed'
      return c.json({ error: msg }, status as 400 | 403 | 404)
    }
  }))

  app.delete('/auth/sessions/:id', guarded({ allowScoped: true }, async ({ c, user, via }) => {
    try {
      const session = await destroyDesktopSession(
        user,
        via,
        c.req.param('id'),
      )
      return c.json({ session })
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 400
      const msg = err instanceof Error ? err.message : 'destroy failed'
      return c.json({ error: msg }, status as 400 | 403 | 404)
    }
  }))

  /** Resolve a connect ticket to guacamole-lite token (for desktop page). */
  app.get('/auth/sessions/:id/connect-token', guarded({ allowScoped: true }, async ({ c, user, deny }) => {
    const ticket = c.req.query('ticket') || ''
    if (!ticket) return c.json({ error: 'ticket required' }, 400)
    const peeked = peekConnectTicket(ticket)
    const sessionId = c.req.param('id')
    if (!peeked || peeked.sessionId !== sessionId) {
      return c.json({ error: 'Invalid or expired ticket' }, 403)
    }
    const row = await getSessionRecord(sessionId)
    if (!row || row.status === 'destroyed') {
      return c.json({ error: 'Not found' }, 404)
    }
    const { authorizeSessionAccess } = await import('./sessions.js')
    const denied = deny(await authorizeSessionAccess(user, row, 'connect'))
    if (denied) return denied
    return c.json({
      token: peeked.token,
      ws_path: env.sessionsGuacWsPath,
      backend: 'guacamole_lite',
    })
  }))
}
