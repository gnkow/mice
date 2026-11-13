import { randomUUID } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { preparePrincipal } from '../../authz.js'
import { env, oidcConfigured } from '../../env.js'
import { recordAuthEvent } from '../audit/authEvents.js'
import { PKCE_COOKIE, completeLogin, startLogin } from './loginFlow.js'
import { buildEndSessionUrl } from './oidc.js'
import { rememberNotificationUser } from '../../notifications.js'
import type { AuditDep } from '../../routeDeps.js'
import { clearSessionCookie, destroySession, getSession, setSessionCookie } from '../session/session.js'
import { handleReauthCallback } from './stepUp.js'
import { enforceIpRateLimit, getClientIp } from '../rateLimit/rateLimitMiddleware.js'
import { RATE_LIMIT_CONFIG } from '../rateLimit/rateLimit.js'

/** After Mice logout, next /auth/login must show IdP credentials (no silent SSO). */
const PROMPT_LOGIN_COOKIE = 'mice_prompt_login'

/** SSO login, callback and logout. */
export function registerLoginRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get('/auth/login', async (c) => {
    if (!oidcConfigured()) {
      return c.json({ error: 'OIDC is not configured' }, 503)
    }
    const { pkceCookie, authorizeUrl } = await startLogin(c.req.query('next'))
    setCookie(c, PKCE_COOKIE, pkceCookie, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    })
    deleteCookie(c, PROMPT_LOGIN_COOKIE, { path: '/' })
    return c.redirect(authorizeUrl)
  })

  app.get('/auth/callback', async (c) => {
    const limited = await enforceIpRateLimit(c, RATE_LIMIT_CONFIG.login)
    if (limited) return limited
    if (!oidcConfigured()) return c.json({ error: 'OIDC is not configured' }, 503)
    const pkceCookie = getCookie(c, PKCE_COOKIE)
    deleteCookie(c, PKCE_COOKIE, {
      path: '/',
      secure: env.cookieSecure,
      sameSite: 'Lax',
    })
    const requestId = c.req.header('x-request-id') ?? randomUUID()
    const result = await completeLogin({
      code: c.req.query('code'),
      state: c.req.query('state'),
      error: c.req.query('error'),
      pkceCookie,
      requestId,
    })
    if (result.reauth) {
      return handleReauthCallback(c, result)
    }
    if (!result.ok) {
      // Known refuse/outage codes land on LoginPage chrome (tickets 04, 32, 38).
      if (result.surface) {
        return c.redirect(`/login?status=${encodeURIComponent(result.surface)}`)
      }
      return c.html(result.html, result.status)
    }
    const sessionUser = result.user
    await preparePrincipal(sessionUser)
    await rememberNotificationUser(sessionUser)
    await setSessionCookie(c, sessionUser)
    await recordAuthEvent({
      type: 'login',
      principal: { iss: sessionUser.iss, sub: sessionUser.sub },
      requestId,
      outcome: 'success',
      clientIp: getClientIp(c),
    })
    await auditMutation(c, sessionUser, 'session', {
      action: 'auth.login',
      message: 'Signed in via SSO',
    })
    return c.redirect(result.dest)
  })

  async function finishLogout(c: Context) {
    const session = await getSession(c)
    if (session) {
      await recordAuthEvent({
        type: 'logout',
        principal: { iss: session.iss, sub: session.sub },
        requestId: c.req.header('x-request-id') ?? randomUUID(),
        outcome: 'success',
        clientIp: getClientIp(c),
      })
      await auditMutation(c, session, 'session', {
        action: 'auth.logout',
        message: 'Signed out',
      })
    }
    await destroySession(c)
    clearSessionCookie(c)
    setCookie(c, PROMPT_LOGIN_COOKIE, '1', {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    })

    // RP-initiated IdP logout when we have an OIDC id_token.
    let idpLogoutUrl: string | null = null
    if (session?.idToken && oidcConfigured()) {
      try {
        idpLogoutUrl = await buildEndSessionUrl({ idToken: session.idToken })
      } catch {
        idpLogoutUrl = null
      }
    }
    return idpLogoutUrl
  }

  app.post('/auth/logout', async (c) => {
    const idpLogoutUrl = await finishLogout(c)
    return c.json({ ok: true, idpLogoutUrl })
  })

  app.get('/auth/logout', async (c) => {
    const idpLogoutUrl = await finishLogout(c)
    if (idpLogoutUrl) return c.redirect(idpLogoutUrl)
    return c.redirect('/login')
  })
}
