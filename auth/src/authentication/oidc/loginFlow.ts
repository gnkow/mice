import type { SessionUser } from '../session/session.js'
import { currentClock, type Clock } from '../../clock.js'
import { defaultOidcProvider, pkceChallenge, randomString, type OidcProvider } from './oidc.js'

export const PKCE_COOKIE = 'mice_oidc_pkce'

type PkceState = {
  verifier: string
  state: string
  nonce: string
  /** Optional relative path to return to after OIDC (e.g. /cli/device?user_code=…). */
  next?: string
  /** Step-up: who must re-authenticate and how fresh the result must be. */
  reauth?: { maxAge: number; sub: string; iss: string }
}

/** Only same-site relative paths outside the login and auth routes are valid return targets. */
export function safeReturnPath(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined
  if (raw.startsWith('/login') || raw.startsWith('/auth/')) return undefined
  return raw
}

/** Step-up may resume an /auth/step-up/ action; every other /auth/ path stays blocked. */
export function safeReauthReturnPath(raw: string | undefined | null): string | undefined {
  if (raw?.startsWith('/auth/step-up/') && !raw.startsWith('//')) return raw
  return safeReturnPath(raw)
}

/** Begin an OIDC authorization-code login: the PKCE cookie value to set and the IdP redirect. */
async function beginLogin(provider: OidcProvider, 
  next?: string | null,
  reauth?: { maxAge: number; sub: string; iss: string },
): Promise<{ pkceCookie: string; authorizeUrl: string }> {
  const verifier = randomString(32)
  const state = randomString(16)
  const nonce = randomString(16)
  const challenge = await pkceChallenge(verifier)
  const safeNext = reauth ? safeReauthReturnPath(next) : safeReturnPath(next)
  const pkce: PkceState = {
    verifier, state, nonce,
    ...(safeNext ? { next: safeNext } : {}),
    ...(reauth ? { reauth } : {}),
  }
  return {
    pkceCookie: Buffer.from(JSON.stringify(pkce)).toString('base64url'),
    // Always prompt=login so SSO shows the IdP credential form (Keycloak SSO cookies can
    // survive a Mice-only logout).
    authorizeUrl: await provider.beginLogin({
      state,
      nonce,
      codeChallenge: challenge,
      promptLogin: true,
      ...(reauth ? { maxAge: reauth.maxAge } : {}),
    }),
  }
}

export type LoginResult =
  | { ok: true; user: SessionUser; dest: string; reauth?: { maxAge: number; sub: string; iss: string } }
  | { ok: false; status: 400 | 500; html: string; reauth?: boolean; reason?: string }

const retry = '<a href="/auth/login">Retry</a>'
const fail = (status: 400 | 500, msg: string, reauth = false): LoginResult => ({
  ok: false,
  status,
  html: `<p>${msg}</p><p>${retry}</p>`,
  ...(reauth ? { reauth: true, reason: msg } : {}),
})

function readPkce(cookie: string | undefined): PkceState | null {
  if (!cookie) return null
  try {
    return JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as PkceState
  } catch {
    return null
  }
}

/** Finish the login: validate state, exchange the code, and build the Session user. */
async function finishLogin(provider: OidcProvider, clock: Clock, input: {
  code?: string
  state?: string
  error?: string
  pkceCookie?: string
}): Promise<LoginResult> {
  if (input.error) return fail(400, `Login failed: ${input.error}`, !!readPkce(input.pkceCookie)?.reauth)
  if (!input.code || !input.state || !input.pkceCookie) return fail(400, 'Missing OIDC state.')
  const pkce = readPkce(input.pkceCookie)
  if (!pkce) return fail(400, 'Invalid OIDC state.')
  const isReauth = !!pkce.reauth
  if (pkce.state !== input.state) return fail(400, 'State mismatch.', isReauth)
  try {
    const user = await provider.completeLogin({
      code: input.code,
      codeVerifier: pkce.verifier,
      nonce: pkce.nonce,
    })
    if (pkce.reauth) {
      if (user.sub !== pkce.reauth.sub || user.iss !== pkce.reauth.iss) {
        return fail(400, 'Re-authentication was completed by a different account.', true)
      }
      const age = Math.floor(clock.now() / 1000) - (user.authTime ?? 0)
      if (user.authTime === undefined || age > pkce.reauth.maxAge + 5) {
        return fail(400, 'Re-authentication was not recent enough.', true)
      }
    }
    return {
      ok: true,
      ...(pkce.reauth ? { reauth: pkce.reauth } : {}),
      dest: (pkce.reauth ? safeReauthReturnPath(pkce.next) : safeReturnPath(pkce.next)) ?? '/',
      user: {
        sub: user.sub,
        iss: user.iss,
        email: user.email,
        ...(user.emailVerified ? { emailVerified: true } : {}),
        name: user.name,
        idToken: user.idToken,
        ...(user.authTime !== undefined ? { authTime: user.authTime } : {}),
        ...(user.groups.length ? { groups: user.groups } : {}),
      },
    }
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : 'login failed', isReauth)
  }
}

/** Login flow over an OIDC provider and clock. */
export function createLoginFlow(deps: { provider: OidcProvider; clock?: Clock }) {
  const clock = deps.clock ?? currentClock
  return {
    startLogin: (next?: string | null, reauth?: { maxAge: number; sub: string; iss: string }) =>
      beginLogin(deps.provider, next, reauth),
    completeLogin: (input: Parameters<typeof finishLogin>[2]) => finishLogin(deps.provider, clock, input),
  }
}

/** Process-wide flow: the environment-configured provider, resolved per call. */
const lazyProvider: OidcProvider = {
  beginLogin: (r) => defaultOidcProvider().beginLogin(r),
  completeLogin: (r) => defaultOidcProvider().completeLogin(r),
  logoutUrl: (o) => defaultOidcProvider().logoutUrl(o),
  verifyJwt: (t) => defaultOidcProvider().verifyJwt(t),
}
const defaults = createLoginFlow({ provider: lazyProvider })
export const startLogin = defaults.startLogin
export const completeLogin = defaults.completeLogin
