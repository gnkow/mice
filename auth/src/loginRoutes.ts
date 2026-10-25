import type { Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { preparePrincipal } from './authz.js'
import { env, oidcConfigured } from './env.js'
import { PKCE_COOKIE, completeLogin, startLogin } from './loginFlow.js'
import { buildEndSessionUrl } from './oidc.js'
import { rememberNotificationUser } from './notifications.js'
import type { AuditDep } from './routeDeps.js'
import { clearSessionCookie, getSession, setSessionCookie } from './session.js'
import { handleReauthCallback } from './stepUp.js'

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
    if (!oidcConfigured()) return c.json({ error: 'OIDC is not configured' }, 503)
    const pkceCookie = getCookie(c, PKCE_COOKIE)
    deleteCookie(c, PKCE_COOKIE, {
      path: '/',
      secure: env.cookieSecure,
      sameSite: 'Lax',
    })
    const result = await completeLogin({
      code: c.req.query('code'),
      state: c.req.query('state'),
      error: c.req.query('error'),
      pkceCookie,
    })
    if (result.reauth) {
      return handleReauthCallback(c, result)
    }
    if (!result.ok) return c.html(result.html, result.status)
    const sessionUser = result.user
    await preparePrincipal(sessionUser)
    await rememberNotificationUser(sessionUser)
    await setSessionCookie(c, sessionUser)
    await auditMutation(c, sessionUser, 'session', {
      action: 'auth.login',
      message: 'Signed in via SSO',
    })
    return c.redirect(result.dest)
  })

  async function finishLogout(c: Context) {
    const session = await getSession(c)
    if (session) {
      await auditMutation(c, session, 'session', {
        action: 'auth.logout',
        message: 'Signed out',
      })
    }
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
