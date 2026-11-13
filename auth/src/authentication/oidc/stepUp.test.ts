import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

let idTokenSub = 'u1'
let authTime = 0
let lastNonce = ''

const { publicKey, privateKey } = await generateKeyPair('RS256')
const stepUpJwk = { ...(await exportJWK(publicKey)), kid: 'step-up', alg: 'RS256', use: 'sig' }

const idp: Server = createServer((req, res) => {
  const base = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`
  res.setHeader('content-type', 'application/json')
  if (req.url?.endsWith('/.well-known/openid-configuration')) {
    res.end(JSON.stringify({
      issuer: base,
      authorization_endpoint: `${base}/auth`,
      token_endpoint: `${base}/token`,
      jwks_uri: `${base}/jwks`,
    }))
    return
  }
  if (req.url?.endsWith('/jwks')) {
    res.end(JSON.stringify({ keys: [stepUpJwk] }))
    return
  }
  req.resume()
  req.on('end', () => {
    const claims = {
      iss: base, aud: 'mice-web', exp: Math.floor(Date.now() / 1000) + 300, nonce: lastNonce,
      sub: idTokenSub, email: `${idTokenSub}@x.io`, email_verified: true,
      groups: ['users'],
      ...(authTime ? { auth_time: authTime } : {}),
    }
    void new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'step-up' })
      .sign(privateKey)
      .then((idToken) => res.end(JSON.stringify({ id_token: idToken })))
  })
})
await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r))
const issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-stepup-'))
process.env.OIDC_ISSUER = issuer
process.env.OIDC_CLIENT_ID = 'mice-web'
process.env.OIDC_REDIRECT_URI = 'http://localhost/auth/callback'
process.env.SESSION_SECRET = 'test-session-secret-for-stepup'

const { Hono } = await import('hono')
const { applyGlobalGuards } = await import('../session/requireAuth.js')
const { completeLogin } = await import('./loginFlow.js')
const {
  registerStepUp,
  handleReauthCallback,
  decideStepUp,
  resolveMaxAgeSec,
} = await import('./stepUp.js')
const { sealSession, getSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { issueCliCredential } = await import('../credentials/cliCredentials.js')
const { queryAudit } = await import('../../audit.js')
const { env, overrideEnv } = await import('../../env.js')
overrideEnv({
  directoryProvider: 'keycloak',
  keycloakAdminUrl: 'http://localhost:8180',
  keycloakRealm: 'mice',
  oidcClientId: env.oidcClientId || 'mice-web',
  oidcClientSecret: env.oidcClientSecret || 'mice-auth-secret',
})
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  return new Response(JSON.stringify([]), { status: 200 })
})
await ensureBootstrapKey()

const now = () => Math.floor(Date.now() / 1000)

await describe('decideStepUp', async () => {
  const baseSession = {
    sub: 'u1',
    iss: issuer,
    email: 'u1@x.io',
    name: 'u1',
    authTime: now() - 10,
  }

  await it('allows a Session whose auth_time is inside the window', () => {
    const decision = decideStepUp({
      session: baseSession,
      hasAuthorizationHeader: false,
      method: 'POST',
      acceptHeader: 'application/json',
      resumePathAndQuery: '/auth/sign/prepare',
      maxAgeSec: 60,
      nowSec: now(),
    })
    assert.equal(decision.kind, 'ok')
    if (decision.kind === 'ok') assert.equal(decision.user.sub, 'u1')
  })

  await it('refuses bearer-only callers with need_browser_session 403', () => {
    const decision = decideStepUp({
      session: null,
      hasAuthorizationHeader: true,
      method: 'GET',
      acceptHeader: 'application/json',
      resumePathAndQuery: '/auth/step-up/demo',
      maxAgeSec: 300,
      nowSec: now(),
    })
    assert.deepEqual(decision, { kind: 'need_browser_session', status: 403 })
  })

  await it('challenges a stale Session with a json reauthUrl for API callers', () => {
    const decision = decideStepUp({
      session: { ...baseSession, authTime: now() - 3600 },
      hasAuthorizationHeader: false,
      method: 'POST',
      acceptHeader: 'application/json',
      resumePathAndQuery: '/auth/sign/execute?x=1',
      maxAgeSec: 60,
      nowSec: now(),
    })
    assert.equal(decision.kind, 'challenge')
    if (decision.kind !== 'challenge') return
    assert.equal(decision.delivery, 'json')
    assert.equal(decision.maxAgeSec, 60)
    assert.match(decision.reauthUrl, /^\/auth\/reauth\?max_age=60&next=/)
    assert.match(decision.reauthUrl, /execute/)
  })

  await it('challenges a stale Session with a redirect for HTML navigations', () => {
    const decision = decideStepUp({
      session: { ...baseSession, authTime: now() - 3600 },
      hasAuthorizationHeader: false,
      method: 'GET',
      acceptHeader: 'text/html',
      resumePathAndQuery: '/auth/step-up/demo',
      maxAgeSec: 300,
      nowSec: now(),
    })
    assert.equal(decision.kind, 'challenge')
    if (decision.kind !== 'challenge') return
    assert.equal(decision.delivery, 'redirect')
  })

  await it('clamps asked max_age into the allowed window', () => {
    assert.equal(resolveMaxAgeSec(undefined), 300)
    assert.equal(resolveMaxAgeSec('60'), 60)
    assert.equal(resolveMaxAgeSec('-5'), 0)
    assert.equal(resolveMaxAgeSec('999999'), 24 * 60 * 60)
    assert.equal(resolveMaxAgeSec('nope'), 300)
  })
})
const app = new Hono()
applyGlobalGuards(app)
registerStepUp(app)
app.get('/auth/callback', async (c) => {
  const pkce = c.req.header('x-pkce')!
  try {
    const result = await completeLogin({
      code: 'c', state: c.req.query('state'), error: c.req.query('error'), pkceCookie: pkce,
    })
    return handleReauthCallback(c, result)
  } catch (error) {
    console.error('[test] completeLogin error:', error)
    return c.text('Internal error', 500)
  }
})

const mk = (sub: string) => ({ sub, iss: issuer, email: `${sub}@x.io`, name: sub })
const cookie = async (sub: string, authAge: number) => {
  const sessionId = await sealSession({ ...mk(sub), authTime: now() - authAge, sessionStart: now() - 100 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

async function reauth(sub: string, authAge: number, returnedAuthTime: number, who = sub) {
  const start = await app.request('/auth/step-up/demo', {
    headers: { cookie: await cookie(sub, authAge), accept: 'text/html' },
  })
  assert.equal(start.status, 302)
  const toReauth = await app.request(start.headers.get('location')!, {
    headers: { cookie: await cookie(sub, authAge) },
  })
  assert.equal(toReauth.status, 302)
  const authorize = new URL(toReauth.headers.get('location')!)
  assert.equal(authorize.searchParams.get('prompt'), 'login')
  assert.ok(authorize.searchParams.get('max_age'))
  const pkce = /mice_oidc_pkce=([^;]+)/.exec(toReauth.headers.get('set-cookie') ?? '')?.[1] ?? ''
  lastNonce = authorize.searchParams.get('nonce')!
  idTokenSub = who
  authTime = returnedAuthTime
  const cb = await app.request(`/auth/callback?code=test_code&state=${authorize.searchParams.get('state')}`, {
    headers: { cookie: await cookie(sub, authAge), 'x-pkce': decodeURIComponent(pkce) },
  })
  return { cb, authorize }
}

await describe('step-up re-authentication', async () => {
  after(() => idp.close())

  await it('passes straight through with a fresh authentication time', async () => {
    const res = await app.request('/auth/step-up/demo', { headers: { cookie: await cookie('u1', 10) } })
    assert.equal(res.status, 200)
  })

  await it('sends a stale Session through the IdP and resumes after a fresh login', async () => {
    const { cb } = await reauth('u1', 3600, now())
    assert.equal(cb.status, 302)
    assert.equal(cb.headers.get('location'), '/auth/step-up/demo')
    const newCookie = /mice_session=([^;]+)/.exec(cb.headers.get('set-cookie') ?? '')?.[1]
    assert.ok(newCookie, 'session cookie refreshed')
    const again = await app.request('/auth/step-up/demo', { headers: { cookie: `${env.cookieName}=${newCookie}` } })
    assert.equal(again.status, 200)
  })

  await it('rejects a returned authentication time older than the maximum age', async () => {
    const { cb } = await reauth('u2', 3600, now() - 3000)
    assert.notEqual(cb.status, 302)
    assert.ok((await queryAudit({ action: 'auth.reauth.failed' })).events.length >= 1)
  })

  await it('rejects a re-authentication by a different Principal', async () => {
    const { cb } = await reauth('u3', 3600, now(), 'someone-else')
    assert.notEqual(cb.status, 302)
  })

  await it('does nothing and audits when the IdP reports an error', async () => {
    const c = await cookie('u4', 3600)
    const start = await app.request('/auth/reauth?max_age=60&next=/auth/step-up/demo', { headers: { cookie: c } })
    const pkce = decodeURIComponent(/mice_oidc_pkce=([^;]+)/.exec(start.headers.get('set-cookie') ?? '')![1]!)
    const res = await app.request('/auth/callback?error=access_denied&state=x', { headers: { cookie: c, 'x-pkce': pkce } })
    assert.notEqual(res.status, 302)
    assert.ok((await queryAudit({ actor: 'u4', action: 'auth.reauth.failed' })).events.length >= 1)
  })

  await it('refuses CLI credential callers', async () => {
    const { accessToken } = await issueCliCredential(mk('u5'))
    const res = await app.request('/auth/step-up/demo', { headers: { authorization: `Bearer ${accessToken}` } })
    assert.equal(res.status, 403)
  })

  await it('answers API callers with 401 and a re-authentication URL', async () => {
    const res = await app.request('/auth/step-up/demo', { headers: { cookie: await cookie('u1', 3600) } })
    assert.equal(res.status, 401)
    const body = (await res.json()) as { error: string; reauthUrl: string }
    assert.equal(body.error, 'reauthentication_required')
    assert.match(body.reauthUrl, /^\/auth\/reauth\?/)
  })
})
