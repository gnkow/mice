import type { Context, Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { actorFromUser, appendAudit } from '../../audit.js'
import { env } from '../../env.js'
import { PKCE_COOKIE, startLogin, type LoginResult } from './loginFlow.js'
import { getSession, setSessionCookie, type SessionUser } from '../session/session.js'

const DEFAULT_MAX_AGE_SEC = 300
const MAX_ALLOWED_AGE_SEC = 24 * 60 * 60

const nowSec = () => Math.floor(Date.now() / 1000)

export function isFreshlyAuthenticated(user: SessionUser, maxAgeSec: number): boolean {
  return user.authTime !== undefined && nowSec() - user.authTime <= maxAgeSec
}

export type StepUpOutcome = { ok: true; user: SessionUser } | { ok: false; response: Response }

/**
 * Demand fresh authentication for a protected action. PATs can never satisfy it. A stale
 * Session gets a redirect (browser navigation) or a 401 carrying `reauthUrl` (API call);
 * the action itself is not performed until the User has re-authenticated at the IdP.
 */
export async function reauthenticate(c: Context, maxAgeSec: number): Promise<StepUpOutcome> {
  const session = await getSession(c)
  if (!session) {
    const status = c.req.header('authorization') ? 403 : 401
    return { ok: false, response: c.json({ error: 'Step-up requires a browser Session' }, status) }
  }
  if (isFreshlyAuthenticated(session, maxAgeSec)) return { ok: true, user: session }
  const resume = new URL(c.req.url)
  const reauthUrl = `/auth/reauth?max_age=${maxAgeSec}&next=${encodeURIComponent(resume.pathname + resume.search)}`
  if (c.req.method === 'GET' && (c.req.header('accept') ?? '').includes('text/html')) {
    return { ok: false, response: c.redirect(reauthUrl) }
  }
  return {
    ok: false,
    response: c.json({ error: 'reauthentication_required', maxAge: maxAgeSec, reauthUrl }, 401),
  }
}

export function registerStepUp(app: Hono): void {
  app.get('/auth/reauth', async (c) => {
    const session = await getSession(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    const asked = Number(c.req.query('max_age') ?? DEFAULT_MAX_AGE_SEC)
    const maxAge = Number.isFinite(asked) ? Math.min(Math.max(0, Math.floor(asked)), MAX_ALLOWED_AGE_SEC) : DEFAULT_MAX_AGE_SEC
    const { pkceCookie, authorizeUrl } = await startLogin(c.req.query('next'), {
      maxAge,
      sub: session.sub,
      iss: session.iss,
    })
    setCookie(c, PKCE_COOKIE, pkceCookie, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    })
    return c.redirect(authorizeUrl)
  })

  // Demo of the mechanism: succeeds only with an authentication newer than 5 minutes.
  app.get('/auth/step-up/demo', async (c) => {
    const step = await reauthenticate(c, DEFAULT_MAX_AGE_SEC)
    if (!step.ok) return step.response
    return c.json({ ok: true, freshWithinSec: DEFAULT_MAX_AGE_SEC })
  })
}

/** Finishes a step-up callback: refresh the Session on success, audit and change nothing on failure. */
export async function handleReauthCallback(c: Context, result: LoginResult): Promise<Response> {
  deleteCookie(c, PKCE_COOKIE, { path: '/', secure: env.cookieSecure, sameSite: 'Lax' })
  const current = await getSession(c)
  if (!result.ok) {
    if (current) {
      await appendAudit({
        actor: actorFromUser(current),
        via: 'session',
        method: c.req.method,
        path: '/auth/callback',
        status: result.status,
        action: 'auth.reauth.failed',
        message: 'Step-up re-authentication failed or was cancelled',
        detail: { reason: result.reason ?? 'failed' },
      })
    }
    return c.html(result.html, result.status)
  }
  if (!current || current.sub !== result.user.sub || current.iss !== result.user.iss) {
    return c.html('<p>Re-authentication does not match your signed-in account.</p>', 400)
  }
  // Keep the original absolute-expiry anchor; only the authentication time and its ID token are refreshed.
  await setSessionCookie(c, {
    ...current,
    idToken: result.user.idToken,
    ...(result.user.authTime !== undefined ? { authTime: result.user.authTime } : {}),
    lastActive: nowSec(),
  })
  await appendAudit({
    actor: actorFromUser(current),
    via: 'session',
    method: c.req.method,
    path: '/auth/callback',
    status: 200,
    action: 'auth.reauth',
    message: 'Step-up re-authentication succeeded',
  })
  return c.redirect(result.dest)
}
