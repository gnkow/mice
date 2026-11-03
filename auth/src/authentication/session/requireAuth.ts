import type { Context, Hono, MiddlewareHandler } from 'hono'
import { actorFromUser, appendAudit, type AuditVia } from '../../audit.js'
import { sameOriginGuard } from './csrf.js'
import { preparePrincipal } from '../../authz.js'
import { env } from '../../env.js'
import { getSession, touchSession, type SessionUser } from './session.js'
import { can, canonicalIssuer, isScopedCredential, type Capability } from './principal.js'
import { resolveCliCredential } from '../credentials/cliCredentials.js'
import { checkUserIdpStatus } from '../access/idpCheck.js'
import { closeIdpOutage, noteIdpOutage } from '../compliance/idpOutage.js'
import { isSuspended } from '../access/miceSuspension.js'
import { considerReenable, recordIdpDisabled } from '../access/reenable.js'

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

/** The raw `Authorization: Bearer` token, or '' when absent. */
export function bearerToken(c: Context): string {
  const auth = c.req.header('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
}

/** The CLI credential's owner for a bearer token, or null when it is expired, revoked or unknown. */
export async function resolveBearer(c: Context): Promise<SessionUser | null> {
  const token = bearerToken(c)
  if (!token) return null
  return resolveCliCredential(token)
}

export type AuthenticationObserver = (user: SessionUser) => void
let observer: AuthenticationObserver = () => {}

/**
 * Sets the observer run for every authenticated request made through `authenticateRequest`.
 * Returns a function restoring the previous observer.
 */
export function setAuthenticationObserver(next: AuthenticationObserver): () => void {
  const prev = observer
  observer = next
  return () => {
    observer = prev
  }
}

/**
 * `authenticate` plus its request effects: records `via` for audit and notifies the
 * authentication observer. Keeps the denial status and message for callers that shape them.
 */
export async function authenticateOutcome(c: Context, policy: AuthPolicy = {}): Promise<AuthOutcome> {
  const r = await authenticate(c, policy)
  if (!r.ok) return r
  if (r.via === 'pat') c.set('authVia' as never, 'pat' as never)
  observer(r.user)
  return r
}

/**
 * Nullable form of `authenticate` for route handlers: `{ user, via }` or null (the handler
 * answers 401).
 */
export async function authenticateRequest(
  c: Context,
  policy: AuthPolicy = {},
): Promise<{ user: SessionUser; via: 'session' | 'pat' } | null> {
  const r = await authenticateOutcome(c, policy)
  return r.ok ? { user: r.user, via: r.via } : null
}

/** Same as `authenticateRequest` for handlers that only need the Principal. */
export async function authenticateUser(c: Context, policy: AuthPolicy = {}): Promise<SessionUser | null> {
  return (await authenticateRequest(c, policy))?.user ?? null
}

export class AuthenticationDenied extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 503,
    message: string,
  ) {
    super(message)
  }
}

/** The authenticated Principal, or throws `AuthenticationDenied` carrying the denial status. */
export async function requirePrincipal(c: Context, policy: AuthPolicy = {}): Promise<SessionUser> {
  const r = await authenticateOutcome(c, policy)
  if (!r.ok) throw new AuthenticationDenied(r.status, r.error)
  return r.user
}

/** The audit `via` for a request: `pat` when it authenticated by PAT, else the given fallback. */
export function callerVia(c: Context, fallback: AuditVia): AuditVia {
  return c.get('authVia' as never) === 'pat' ? 'pat' : fallback
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
  | { ok: false; status: 400 | 401 | 403 | 503; error: string }

const deny = (status: 400 | 401 | 403 | 503, error: string): AuthOutcome => ({ ok: false, status, error })

async function refuseSuspended(c: Context, user: SessionUser, via: 'session' | 'pat'): Promise<AuthOutcome> {
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method: c.req.method,
    path: c.req.path,
    status: 403,
    action: 'auth.suspended',
    message: `Refused ${canonicalIssuer(user.iss)}|${user.sub}`,
  })
  return deny(403, 'Suspended')
}

/**
 * Authenticates a request against a policy: cookie Session first, then a PAT, with the
 * scoped-credential rules decided here rather than per route. `urn:mice:service` is not a caller.
 */
export async function authenticate(c: Context, policy: AuthPolicy = {}): Promise<AuthOutcome> {
  const session = policy.credential === 'pat' ? null : await getSession(c)
  if (session) {
    if (canonicalIssuer(session.iss) === 'urn:mice:service') return deny(401, 'Authentication required')
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
    // Synthetic Playwright issuer: skip live IdP when AUTH_DEV_MODE is on.
    const skipIdp = env.authDevMode && canonicalIssuer(session.iss) === 'mice-e2e'
    if (!skipIdp) {
      let account: Awaited<ReturnType<typeof checkUserIdpStatus>>
      try {
        account = await checkUserIdpStatus(session)
      } catch {
        await noteIdpOutage({
          at: Date.now(),
          check: 'authenticated-request',
          requestId: c.req.header('x-request-id') ?? 'authenticated-request',
        })
        return deny(503, 'Service Unavailable - IdP check failed')
      }
      await closeIdpOutage(Date.now())
      const idpStatus = account.status
      if (idpStatus === 'disabled') await recordIdpDisabled(session)
      if (idpStatus !== 'enabled') {
        return deny(503, 'Service Unavailable - IdP check failed')
      }
      if (!account.name.trim()) {
        return deny(403, 'Your account has no name in the identity provider.')
      }
    }
    const reenable = await considerReenable(session, async (event) => {
      const stored = await appendAudit({
        actor: actorFromUser(session),
        via: 'session',
        method: c.req.method,
        path: c.req.path,
        status: 200,
        action: 'auth.reenable.automatic',
        message: event.message,
        detail: event.detail,
      })
      return stored?.id ?? null
    })
    if (reenable === 'awaiting-confirmation') return deny(403, 'Re-enable confirmation required')
    if (await isSuspended(session)) return refuseSuspended(c, session, 'session')

    await preparePrincipal(session)
    return { ok: true, user: session, via: 'session' }
  }
  if (policy.credential === 'session') return deny(401, 'Authentication required')

  const pat = await resolveBearer(c)
  if (!pat || canonicalIssuer(pat.iss) === 'urn:mice:service' || (!policy.allowScoped && isScopedCredential(pat))) {
    return deny(401, 'Authentication required')
  }
  if (policy.requires && !can(pat, policy.requires.capability)) return deny(403, policy.requires.message)
  if (await isSuspended(pat)) return refuseSuspended(c, pat, 'pat')
  await preparePrincipal(pat)
  return { ok: true, user: pat, via: 'pat' }
}
