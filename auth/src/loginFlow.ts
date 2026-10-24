import type { SessionUser } from './session.js'
import { buildAuthorizeUrl, exchangeCode, loadOidcConfig, pkceChallenge, randomString } from './oidc.js'

type PkceState = {
  verifier: string
  state: string
  nonce: string
  /** Optional relative path to return to after OIDC (e.g. /cli/device?user_code=…). */
  next?: string
}

/** Only same-site relative paths outside the login and auth routes are valid return targets. */
export function safeReturnPath(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined
  if (raw.startsWith('/login') || raw.startsWith('/auth/')) return undefined
  return raw
}

/** Begin an OIDC authorization-code login: the PKCE cookie value to set and the IdP redirect. */
export async function startLogin(
  next?: string | null,
): Promise<{ pkceCookie: string; authorizeUrl: string }> {
  await loadOidcConfig()
  const verifier = randomString(32)
  const state = randomString(16)
  const nonce = randomString(16)
  const challenge = await pkceChallenge(verifier)
  const safeNext = safeReturnPath(next)
  const pkce: PkceState = { verifier, state, nonce, ...(safeNext ? { next: safeNext } : {}) }
  return {
    pkceCookie: Buffer.from(JSON.stringify(pkce)).toString('base64url'),
    // Always prompt=login so SSO shows the IdP credential form (Keycloak SSO cookies can
    // survive a Mice-only logout).
    authorizeUrl: buildAuthorizeUrl({
      state,
      nonce,
      codeChallenge: challenge,
      promptLogin: true,
    }),
  }
}

export type LoginResult =
  | { ok: true; user: SessionUser; dest: string }
  | { ok: false; status: 400 | 500; html: string }

const retry = '<a href="/auth/login">Retry</a>'
const fail = (status: 400 | 500, msg: string): LoginResult => ({
  ok: false,
  status,
  html: `<p>${msg}</p><p>${retry}</p>`,
})

/** Finish the login: validate state, exchange the code, and build the Session user. */
export async function completeLogin(input: {
  code?: string
  state?: string
  error?: string
  pkceCookie?: string
}): Promise<LoginResult> {
  if (input.error) return fail(400, `Login failed: ${input.error}`)
  if (!input.code || !input.state || !input.pkceCookie) return fail(400, 'Missing OIDC state.')
  let pkce: PkceState
  try {
    pkce = JSON.parse(Buffer.from(input.pkceCookie, 'base64url').toString('utf8')) as PkceState
  } catch {
    return fail(400, 'Invalid OIDC state.')
  }
  if (pkce.state !== input.state) return fail(400, 'State mismatch.')
  try {
    const user = await exchangeCode({
      code: input.code,
      codeVerifier: pkce.verifier,
      nonce: pkce.nonce,
    })
    return {
      ok: true,
      dest: safeReturnPath(pkce.next) ?? '/',
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
    return fail(500, e instanceof Error ? e.message : 'login failed')
  }
}
