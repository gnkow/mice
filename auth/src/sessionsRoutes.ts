import type { Hono } from 'hono'
import { actorFromUser, appendAudit } from './audit.js'
import { preparePrincipal } from './authz.js'
import { env } from './env.js'
import { getSession, type SessionUser } from './session.js'
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
import { resolvePat } from './tokens.js'

async function requireAuth(c: {
  req: { header: (name: string) => string | undefined }
}): Promise<{ user: SessionUser; via: 'session' | 'pat' } | null> {
  const session = await getSession(c as never)
  if (session) {
    preparePrincipal(session)
    return { user: session, via: 'session' }
  }
  const auth = c.req.header('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (bearer) {
    const patUser = resolvePat(bearer)
    if (patUser) {
      preparePrincipal(patUser)
      return { user: patUser, via: 'pat' }
    }
  }
  return null
}

export function registerSessionRoutes(app: Hono) {
  app.get('/auth/sessions/templates', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    if (!env.sessionsEnabled) {
      return c.json({ error: 'Sessions disabled' }, 503)
    }
    return c.json({ templates: listSessionTemplates() })
  })

  app.get('/auth/sessions/retention', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    return c.json(sessionsAuditRetentionPolicy())
  })

  app.post('/auth/sessions', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    if (!env.sessionsEnabled) {
      return c.json({ error: 'Sessions disabled' }, 503)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const parsed = parseCreateBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      const session = await createDesktopSession(
        authed.user,
        authed.via,
        parsed,
      )
      return c.json({ session: publicSession(session) }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'create failed'
      const explicit = err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 0
      const status = explicit || (/Forbidden|requires repository/i.test(msg) ? 403 : 400)
      return c.json({ error: msg }, status as 400 | 403 | 404 | 409 | 503)
    }
  })

  app.get('/auth/sessions', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const all = c.req.query('all') === '1' || c.req.query('all') === 'true'
    const workspaceId = c.req.query('workspace_id') || undefined
    const namespace = c.req.query('namespace') || undefined
    const repo = c.req.query('repo') || undefined
    const sessions = listDesktopSessions({ user: authed.user, all, workspaceId, namespace, repo })
    return c.json({ sessions })
  })

  app.get('/auth/sessions/:id', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const row = getSessionRecord(c.req.param('id'))
    if (!row || row.status === 'destroyed') {
      return c.json({ error: 'Not found' }, 404)
    }
    const { authorizeSessionAccess } = await import('./sessions.js')
    const gate = authorizeSessionAccess(authed.user, row, 'read')
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    return c.json({ session: publicSession(row) })
  })

  app.post('/auth/sessions/:id/connect', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    try {
      const result = await connectDesktopSession(
        authed.user,
        authed.via,
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
  })

  app.post('/auth/sessions/:id/disconnect', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const updated = markSessionDisconnect(
      authed.user,
      authed.via,
      c.req.param('id'),
    )
    if (!updated) return c.json({ error: 'Not found' }, 404)
    return c.json({ session: updated })
  })

  app.post('/auth/sessions/:id/retry', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    try {
      const { retryDesktopSession } = await import('./sessions.js')
      const session = await retryDesktopSession(
        authed.user,
        authed.via,
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
  })

  app.put('/auth/sessions/:id/mounts', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid body' }, 400)
    const { parseMountsList, updateSessionMounts } = await import('./sessions.js')
    const parsed = parseMountsList((body as { mounts?: unknown }).mounts)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      const session = await updateSessionMounts(authed.user, authed.via, c.req.param('id'), parsed)
      return c.json({ session })
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : 400
      const msg = err instanceof Error ? err.message : 'mount update failed'
      const holder = err && typeof err === 'object' && 'holder' in err ? (err as { holder: unknown }).holder : undefined
      return c.json({ error: msg, ...(holder ? { holder } : {}) }, status as 400 | 403 | 404 | 409 | 423 | 504)
    }
  })

  app.post('/auth/sessions/:id/remount', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    let body: { workspace_id?: unknown; mount_path?: unknown } = {}
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      /* body is optional */
    }
    try {
      const { remountDesktopSession } = await import('./sessions.js')
      const session = await remountDesktopSession(authed.user, authed.via, c.req.param('id'), {
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
  })

  app.post('/auth/sessions/:id/stop', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    try {
      const session = await stopDesktopSession(
        authed.user,
        authed.via,
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
  })

  app.delete('/auth/sessions/:id', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    try {
      const session = await destroyDesktopSession(
        authed.user,
        authed.via,
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
  })

  /** Resolve a connect ticket to guacamole-lite token (for desktop page). */
  app.get('/auth/sessions/:id/connect-token', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const ticket = c.req.query('ticket') || ''
    if (!ticket) return c.json({ error: 'ticket required' }, 400)
    const peeked = peekConnectTicket(ticket)
    const sessionId = c.req.param('id')
    if (!peeked || peeked.sessionId !== sessionId) {
      return c.json({ error: 'Invalid or expired ticket' }, 403)
    }
    const row = getSessionRecord(sessionId)
    if (!row || row.status === 'destroyed') {
      return c.json({ error: 'Not found' }, 404)
    }
    const { authorizeSessionAccess } = await import('./sessions.js')
    const gate = authorizeSessionAccess(authed.user, row, 'connect')
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    return c.json({
      token: peeked.token,
      ws_path: env.sessionsGuacWsPath,
      backend: 'guacamole_lite',
    })
  })
}
