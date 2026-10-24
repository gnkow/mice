import type { Context, Hono, MiddlewareHandler } from 'hono'
import { sameOriginGuard } from './csrf.js'
import { preparePrincipal } from './authz.js'
import { env } from './env.js'
import { getSession, touchSession, type SessionUser } from './session.js'
import { can, isScopedCredential, type Capability } from './principal.js'
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

  const patUser = resolveBearer(c)
  if (patUser) {
    preparePrincipal(patUser)
    return { user: patUser, via: 'pat' }
  }

  return null
}

/** The raw `Authorization: Bearer` token, or '' when absent. */
export function bearerToken(c: Context): string {
  const auth = c.req.header('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
}

/** The PAT's owner for a bearer token, or null when it is expired, revoked or unknown. */
export function resolveBearer(c: Context): SessionUser | null {
  const token = bearerToken(c)
  return token ? resolvePat(token) : null
}

type AuthenticatedHook = (user: SessionUser) => void
const hooks: AuthenticatedHook[] = []
/** Registers a callback run for every authenticated request made through `authenticateUser`. */
export function onAuthenticated(fn: AuthenticatedHook): void {
  hooks.push(fn)
}

/**
 * Nullable form of `authenticate` for route handlers: records `authVia` on the context
 * (for audit) and runs the `onAuthenticated` hooks.
 */
export async function authenticateUser(c: Context, policy: AuthPolicy = {}): Promise<SessionUser | null> {
  const r = await authenticate(c, policy)
  if (!r.ok) return null
  if (r.via === 'pat') c.set('authVia' as never, 'pat' as never)
  for (const fn of hooks) fn(r.user)
  return r.user
}

export type AuthPolicy = {
  /** `session` accepts only the browser cookie; default accepts a PAT too. */
  credential?: 'session' | 'any' | 'pat'
  /** Scoped PATs are rejected unless this is true (default false: they cannot act as their owner). */
  allowScoped?: boolean
  /** The Principal's kind must have this capability, else 403 with `message`. */
  requires?: { capability: Capability; message: string }
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
  const session = policy.credential === 'pat' ? null : await getSession(c)
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
    if (policy.requires && !can(session, policy.requires.capability)) return deny(403, policy.requires.message)
    preparePrincipal(session)
    return { ok: true, user: session, via: 'session' }
  }
  if (policy.credential === 'session') return deny(401, 'Authentication required')

  const pat = resolveBearer(c)
  if (!pat || (!policy.allowScoped && isScopedCredential(pat))) return deny(401, 'Authentication required')
  if (policy.requires && !can(pat, policy.requires.capability)) return deny(403, policy.requires.message)
  preparePrincipal(pat)
  return { ok: true, user: pat, via: 'pat' }
}
