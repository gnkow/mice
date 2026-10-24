import type { Context, Hono } from 'hono'
import { sameOriginGuard } from './csrf.js'
import { preparePrincipal } from './authz.js'
import { getSession, type SessionUser } from './session.js'
import { sessionActivity } from './sessionActivity.js'
import { resolvePat } from './tokens.js'

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
