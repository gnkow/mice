import type { Context, Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { actorFromUser } from '../../../audit/index.js'
import { appendAudit } from '../../../audit/index.js'
import { env } from '../../../shared/index.js'
import { auditChange } from '../../../audit/change.js'
import { EMPTY_AUDIT_CHANGE } from '../../../audit/change.js'
import { PKCE_COOKIE, startLogin, type LoginResult } from './loginFlow.js'
import { getSession, setSessionCookie, type SessionUser } from '../session/session.js'

const DEFAULT_MAX_AGE_SEC = 300
const MAX_ALLOWED_AGE_SEC = 24 * 60 * 60

const nowSec = () => Math.floor(Date.now() / 1000)

/** Clamp a caller-supplied max_age into the step-up window (0 … 24h; default 300). */
export function resolveMaxAgeSec(raw: unknown): number {
  const asked = Number(raw ?? DEFAULT_MAX_AGE_SEC)
  return Number.isFinite(asked)
    ? Math.min(Math.max(0, Math.floor(asked)), MAX_ALLOWED_AGE_SEC)
    : DEFAULT_MAX_AGE_SEC
}

export function isFreshlyAuthenticated(
  user: SessionUser,
  maxAgeSec: number,
  atSec: number = nowSec(),
): boolean {
  return user.authTime !== undefined && atSec - user.authTime <= maxAgeSec
}

export type StepUpDecision =
  | { kind: 'ok'; user: SessionUser }
  | { kind: 'need_browser_session'; status: 401 | 403 }
  | { kind: 'challenge'; delivery: 'redirect' | 'json'; reauthUrl: string; maxAgeSec: number }

/**
 * Pure step-up decision: bearer vs browser Session, freshness from auth_time, and
 * redirect vs JSON challenge. HTTP adapters map this to Response shapes.
 */
export function decideStepUp(input: {
  session: SessionUser | null
  hasAuthorizationHeader: boolean
  method: string
  acceptHeader: string
  resumePathAndQuery: string
  maxAgeSec: number
  nowSec: number
}): StepUpDecision {
  if (!input.session) {
    return {
      kind: 'need_browser_session',
      status: input.hasAuthorizationHeader ? 403 : 401,
    }
  }
  if (isFreshlyAuthenticated(input.session, input.maxAgeSec, input.nowSec)) {
    return { kind: 'ok', user: input.session }
  }
  const reauthUrl =
    `/auth/reauth?max_age=${input.maxAgeSec}` +
    `&next=${encodeURIComponent(input.resumePathAndQuery)}`
  const wantsHtml =
    input.method === 'GET' && input.acceptHeader.includes('text/html')
  return {
    kind: 'challenge',
    delivery: wantsHtml ? 'redirect' : 'json',
    reauthUrl,
    maxAgeSec: input.maxAgeSec,
  }
}

export type StepUpOutcome = { ok: true; user: SessionUser } | { ok: false; response: Response }

/**
 * Demand fresh authentication for a protected action. PATs can never satisfy it. A stale
 * Session gets a redirect (browser navigation) or a 401 carrying `reauthUrl` (API call);
 * the action itself is not performed until the User has re-authenticated at the IdP.
 */
export async function reauthenticate(c: Context, maxAgeSec: number): Promise<StepUpOutcome> {
  const session = await getSession(c)
  const resume = new URL(c.req.url)
  const decision = decideStepUp({
    session,
    hasAuthorizationHeader: Boolean(c.req.header('authorization')),
    method: c.req.method,
    acceptHeader: c.req.header('accept') ?? '',
    resumePathAndQuery: resume.pathname + resume.search,
    maxAgeSec,
    nowSec: nowSec(),
  })
  if (decision.kind === 'ok') return { ok: true, user: decision.user }
  if (decision.kind === 'need_browser_session') {
    return {
      ok: false,
      response: c.json({ error: 'Step-up requires a browser Session' }, decision.status),
    }
  }
  if (decision.delivery === 'redirect') {
    return { ok: false, response: c.redirect(decision.reauthUrl) }
  }
  return {
    ok: false,
    response: c.json(
      {
        error: 'reauthentication_required',
        maxAge: decision.maxAgeSec,
        reauthUrl: decision.reauthUrl,
      },
      401,
    ),
  }
}

export function registerStepUp(app: Hono): void {
  app.get('/auth/reauth', async (c) => {
    const session = await getSession(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    const maxAge = resolveMaxAgeSec(c.req.query('max_age'))
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

export type ReauthCallbackDecision =
  | { kind: 'login_failed'; status: number; html: string; reason: string; audit: boolean }
  | { kind: 'principal_mismatch'; status: 400; html: string }
  | {
      kind: 'refresh'
      dest: string
      nextAuthTime?: number
      idToken: string
    }

/**
 * Pure step-up callback admission: failed login vs wrong Principal vs refresh Session.
 * HTTP adapters own cookies, audit writes, and redirects.
 */
export function decideReauthCallback(
  current: SessionUser | null,
  result: LoginResult,
): ReauthCallbackDecision {
  if (!result.ok) {
    return {
      kind: 'login_failed',
      status: result.status,
      html: result.html,
      reason: result.reason ?? 'failed',
      audit: Boolean(current),
    }
  }
  if (!current || current.sub !== result.user.sub || current.iss !== result.user.iss) {
    return {
      kind: 'principal_mismatch',
      status: 400,
      html: '<p>Re-authentication does not match your signed-in account.</p>',
    }
  }
  return {
    kind: 'refresh',
    dest: result.dest,
    idToken: result.user.idToken ?? '',
    ...(result.user.authTime !== undefined ? { nextAuthTime: result.user.authTime } : {}),
  }
}

/** Finishes a step-up callback: refresh the Session on success, audit and change nothing on failure. */
export async function handleReauthCallback(c: Context, result: LoginResult): Promise<Response> {
  deleteCookie(c, PKCE_COOKIE, { path: '/', secure: env.cookieSecure, sameSite: 'Lax' })
  const current = await getSession(c)
  const decision = decideReauthCallback(current, result)
  if (decision.kind === 'login_failed') {
    if (decision.audit && current) {
      await appendAudit({
        actor: actorFromUser(current),
        via: 'session',
        method: c.req.method,
        path: '/auth/callback',
        status: decision.status,
        action: 'auth.reauth.failed',
        change: EMPTY_AUDIT_CHANGE,
        message: 'Step-up re-authentication failed or was cancelled',
        detail: { reason: decision.reason },
      })
    }
    return c.html(decision.html, decision.status as 400 | 403 | 500 | 503)
  }
  if (decision.kind === 'principal_mismatch') {
    return c.html(decision.html, decision.status)
  }
  // Keep the original absolute-expiry anchor; only the authentication time and its ID token are refreshed.
  const authTimeBefore = current!.authTime ?? null
  await setSessionCookie(c, {
    ...current!,
    idToken: decision.idToken,
    ...(decision.nextAuthTime !== undefined ? { authTime: decision.nextAuthTime } : {}),
    lastActive: nowSec(),
  })
  await appendAudit({
    actor: actorFromUser(current!),
    via: 'session',
    method: c.req.method,
    path: '/auth/callback',
    status: 200,
    action: 'auth.reauth',
    // A refresh that lands on the same auth_time is not refused: the user is mid-ceremony.
    change: auditChange(
      { auth_time: authTimeBefore },
      { auth_time: decision.nextAuthTime ?? authTimeBefore },
    ),
    message: 'Step-up re-authentication succeeded',
  })
  return c.redirect(decision.dest)
}
