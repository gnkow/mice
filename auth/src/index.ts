import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { env, oidcConfigured } from './env.js'
import {
  buildAuthorizeUrl,
  buildEndSessionUrl,
  exchangeCode,
  loadOidcConfig,
  pkceChallenge,
  randomString,
} from './oidc.js'
import { proxyToOxen } from './proxy.js'
import {
  clearSessionCookie,
  getSession,
  setSessionCookie,
  type SessionUser,
} from './session.js'
import { createPat, listPatsForUser, resolvePat, revokePat } from './tokens.js'

const PKCE_COOKIE = 'boxen_oidc_pkce'
/** After Boxen logout, next /auth/login must show IdP credentials (no silent SSO). */
const PROMPT_LOGIN_COOKIE = 'boxen_prompt_login'

type PkceState = {
  verifier: string
  state: string
  nonce: string
}

const app = new Hono()

app.get('/healthz', (c) => c.json({ ok: true }))

/** Public CLI remote hint (no secrets). */
app.get('/auth/cli-info', (c) => {
  const remote = env.publicOxenRemote
  let authHost = remote
  try {
    const u = new URL(remote)
    authHost = u.host
  } catch {
    /* keep remote */
  }
  return c.json({
    remote,
    authHost,
    configExample: `oxen config --auth ${authHost} <PAT>`,
    cloneExample: `oxen clone ${remote}/<namespace>/<repo>`,
  })
})

app.get('/auth/me', async (c) => {
  const session = await getSession(c)
  if (!session) return c.json({ authenticated: false }, 401)
  return c.json({
    authenticated: true,
    user: {
      sub: session.sub,
      iss: session.iss,
      email: session.email,
      name: session.name,
    },
  })
})

async function requireSession(c: Parameters<typeof getSession>[0]) {
  const session = await getSession(c)
  if (!session) return null
  return session
}

app.get('/auth/tokens', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  return c.json({ tokens: listPatsForUser(session) })
})

app.post('/auth/tokens', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  let label = 'CLI token'
  try {
    const body = (await c.req.json()) as { label?: string }
    if (body.label?.trim()) label = body.label.trim()
  } catch {
    /* empty body ok */
  }
  const { token, pat } = createPat(session, label)
  let authHost = env.publicOxenRemote
  try {
    authHost = new URL(env.publicOxenRemote).host
  } catch {
    /* keep */
  }
  return c.json({
    token,
    pat,
    cli: {
      remote: env.publicOxenRemote,
      config: `oxen config --auth ${authHost} ${token}`,
    },
  })
})

app.delete('/auth/tokens/:id', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const id = c.req.param('id')
  const ok = revokePat(session, id)
  if (!ok) return c.json({ error: 'Token not found' }, 404)
  return c.json({ ok: true })
})

app.post('/auth/dev-login', async (c) => {
  if (!env.authDevMode) {
    return c.json({ error: 'AUTH_DEV_MODE is disabled' }, 404)
  }
  let override: Partial<SessionUser> = {}
  try {
    override = (await c.req.json()) as Partial<SessionUser>
  } catch {
    /* empty body ok */
  }
  const user: SessionUser = {
    sub: override.sub || env.devUser.sub,
    iss: override.iss || env.devUser.iss,
    email: override.email || env.devUser.email,
    name: override.name || env.devUser.name,
  }
  await setSessionCookie(c, user)
  deleteCookie(c, PROMPT_LOGIN_COOKIE, { path: '/' })
  return c.json({ ok: true, user })
})

app.get('/auth/login', async (c) => {
  if (!oidcConfigured()) {
    if (env.authDevMode) {
      return c.redirect('/auth/dev-login-page')
    }
    return c.json({ error: 'OIDC is not configured' }, 503)
  }
  await loadOidcConfig()
  const verifier = randomString(32)
  const state = randomString(16)
  const nonce = randomString(16)
  const challenge = await pkceChallenge(verifier)
  const pkce: PkceState = { verifier, state, nonce }
  setCookie(c, PKCE_COOKIE, Buffer.from(JSON.stringify(pkce)).toString('base64url'), {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  })
  // Always prompt=login so Sign in with SSO shows the IdP credential form
  // (covers Keycloak SSO cookies that survived Boxen-only logout).
  deleteCookie(c, PROMPT_LOGIN_COOKIE, { path: '/' })
  return c.redirect(
    buildAuthorizeUrl({
      state,
      nonce,
      codeChallenge: challenge,
      promptLogin: true,
    }),
  )
})

/** Tiny HTML form when OIDC is off but DEV mode is on (manual browser login). */
app.get('/auth/dev-login-page', async (c) => {
  if (!env.authDevMode) return c.text('Not found', 404)
  return c.html(`<!doctype html>
<html><head><meta charset="utf-8"><title>Boxen dev login</title></head>
<body>
  <h1>Boxen dev login</h1>
  <p>AUTH_DEV_MODE is enabled (no IdP).</p>
  <button id="go">Sign in as ${env.devUser.name}</button>
  <script>
    document.getElementById('go').onclick = async () => {
      await fetch('/auth/dev-login', { method: 'POST', credentials: 'same-origin' })
      location.href = '/'
    }
  </script>
</body></html>`)
})

app.get('/auth/callback', async (c) => {
  if (!oidcConfigured()) return c.json({ error: 'OIDC is not configured' }, 503)
  const code = c.req.query('code')
  const state = c.req.query('state')
  const err = c.req.query('error')
  if (err) {
    return c.html(`<p>Login failed: ${err}</p><p><a href="/auth/login">Retry</a></p>`, 400)
  }
  const raw = getCookie(c, PKCE_COOKIE)
  deleteCookie(c, PKCE_COOKIE, {
    path: '/',
    secure: env.cookieSecure,
    sameSite: 'Lax',
  })
  if (!code || !state || !raw) {
    return c.html('<p>Missing OIDC state. <a href="/auth/login">Retry</a></p>', 400)
  }
  let pkce: PkceState
  try {
    pkce = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as PkceState
  } catch {
    return c.html('<p>Invalid OIDC state. <a href="/auth/login">Retry</a></p>', 400)
  }
  if (pkce.state !== state) {
    return c.html('<p>State mismatch. <a href="/auth/login">Retry</a></p>', 400)
  }
  try {
    const user = await exchangeCode({
      code,
      codeVerifier: pkce.verifier,
    })
    await setSessionCookie(c, {
      sub: user.sub,
      iss: user.iss,
      email: user.email,
      name: user.name,
      idToken: user.idToken,
    })
    return c.redirect('/')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'login failed'
    return c.html(`<p>${msg}</p><p><a href="/auth/login">Retry</a></p>`, 500)
  }
})

async function finishLogout(c: Parameters<typeof getSession>[0]) {
  const session = await getSession(c)
  clearSessionCookie(c)
  setCookie(c, PROMPT_LOGIN_COOKIE, '1', {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  })

  // Only RP-initiated IdP logout when we have a real OIDC id_token (not AUTH_DEV_MODE).
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

async function requireAuth(c: Parameters<typeof proxyToOxen>[0]) {
  const session = await getSession(c)
  if (session) return { user: session as SessionUser, via: 'session' as const }

  const auth = c.req.header('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''

  if (bearer) {
    const patUser = resolvePat(bearer)
    if (patUser) return { user: patUser, via: 'pat' as const }
  }

  if (env.breakglassToken && auth === `Bearer ${env.breakglassToken}`) {
    return {
      user: {
        sub: 'breakglass',
        iss: 'boxen-breakglass',
        email: 'breakglass@boxen.local',
        name: 'Breakglass',
      } satisfies SessionUser,
      via: 'breakglass' as const,
    }
  }
  return null
}

app.all('/api/*', async (c) => {
  const authed = await requireAuth(c)
  if (!authed) {
    return c.json(
      {
        status: 'error',
        status_message: 'unauthorized',
        error: { detail: 'Authentication required' },
      },
      401,
    )
  }
  return proxyToOxen(c, authed.user)
})

console.log(
  `[boxen-auth] listening on :${env.port} → oxen ${env.oxenUpstream}` +
    ` (dev=${env.authDevMode} oidc=${oidcConfigured()})`,
)

serve({ fetch: app.fetch, port: env.port })
