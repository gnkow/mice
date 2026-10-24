import type { Context, Hono, MiddlewareHandler } from 'hono'
import { sameOriginGuard } from './csrf.js'
import { preparePrincipal } from './authz.js'
import { env } from './env.js'
import { getSession, touchSession, type SessionUser } from './session.js'
import { isScopedCredential, SERVICE_ISSUER } from './principal.js'
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

export type AuthPolicy = {
  /** `session` accepts only the browser cookie; default accepts a PAT too. */
  credential?: 'session' | 'any'
  /** Scoped PATs are rejected unless this is true (default false: they cannot act as their owner). */
  allowScoped?: boolean
  /** Service principals are refused with this message (they have no UI-bound resources). */
  refuseServiceWith?: string
  /** Cookie Sessions on unsafe methods must carry a same-site Origin (PATs are not CSRF-prone). */
  originCheck?: boolean
  /** Cookie Sessions on unsafe methods must send application/json. */
  jsonOnly?: boolean
}

export type AuthOutcome =
  | { ok: true; user: SessionUser; via: 'session' | 'pat' }
  | { ok: false; status: 400 | 401 | 403; error: string }

const deny = (status: 400 | 401 | 403, error: string): AuthOutcome => ({ ok: false, status, error })

/**
 * Authenticates a request against a policy: cookie Session first, then a PAT, with the
 * scoped-credential and service-principal rules decided here rather than per route.
 */
export async function authenticate(c: Context, policy: AuthPolicy = {}): Promise<AuthOutcome> {
  const session = await getSession(c)
  if (session) {
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      if (policy.originCheck) {
        const origin = c.req.header('origin')
        const expected = new URL(env.publicWebOrigin).origin
        if (!origin || (origin !== new URL(c.req.url).origin && origin !== expected)) {
          return deny(403, 'Origin check failed')
        }
      }
      if (policy.jsonOnly && !c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
        return deny(400, 'Expected application/json')
      }
    }
    if (policy.refuseServiceWith && session.iss === SERVICE_ISSUER) return deny(403, policy.refuseServiceWith)
    preparePrincipal(session)
    return { ok: true, user: session, via: 'session' }
  }
  if (policy.credential === 'session') return deny(401, 'Authentication required')

  const auth = c.req.header('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const pat = bearer ? resolvePat(bearer) : null
  if (!pat || (!policy.allowScoped && isScopedCredential(pat))) return deny(401, 'Authentication required')
  if (policy.refuseServiceWith && pat.iss === SERVICE_ISSUER) return deny(403, policy.refuseServiceWith)
  preparePrincipal(pat)
  return { ok: true, user: pat, via: 'pat' }
}
