import type { Context, Hono, MiddlewareHandler } from 'hono'
import { sameOriginGuard } from './csrf.js'
import { preparePrincipal } from './authz.js'
import { env } from './env.js'
import { getSession, touchSession, type SessionUser } from './session.js'
import { resolvePat } from './tokens.js'

/** Unattended page polls must not keep an idle Session alive. */
const BACKGROUND_POLL = /^\/auth\/(notifications|announcements)(\/|$)/

/** Sliding idle timeout: user activity re-seals the Session cookie after the handler ran. */
const sessionActivity: MiddlewareHandler = async (c, next) => {
  await next()
  if (env.sessionIdleSec <= 0) return
  if (c.req.method === 'GET' && BACKGROUND_POLL.test(c.req.path)) return
  if (c.res.headers.get('set-cookie')?.includes(`${env.cookieName}=`)) return
  const session = await getSession(c)
  if (session) await touchSession(c, session)
}

/** Global middleware, in order: CSRF check first, then idle-timeout activity re-seal. */
export function applyGlobalGuards(app: Hono): void {
  app.use('*', sameOriginGuard)
  app.use('*', sessionActivity)
}

/** Session cookie wins; a missing, expired or revoked cookie falls back to a Bearer PAT. */
export async function requireAuth(
  c: Context,
): Promise<{ user: SessionUser; via: 'session' | 'pat' } | null> {
  const session = await getSession(c)
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
