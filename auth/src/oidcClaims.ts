import { normalizeGroupsClaim } from './authzTypes.js'

/** Identity asserted by the IdP after a completed login. */
export type OidcClaims = {
  sub: string
  iss: string
  email: string
  name: string
  idToken: string
  groups: string[]
  authTime?: number
  emailVerified: boolean
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomString(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1]
  if (!part) throw new Error('Malformed id_token')
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

/**
 * Claim checks for an id_token received directly from the token endpoint over TLS.
 * The JWS signature is verified separately, only when OIDC_VERIFY_ID_TOKEN is on.
 */
export function validateIdTokenClaims(
  payload: Record<string, unknown>,
  expected: { issuers: string[]; audience: string; nonce: string; nowSec?: number },
): void {
  const norm = (v: string) => v.replace(/\/$/, '')
  const iss = typeof payload.iss === 'string' ? norm(payload.iss) : ''
  if (!iss || !expected.issuers.map(norm).includes(iss)) {
    throw new Error('id_token issuer mismatch')
  }
  const aud = payload.aud
  const auds = Array.isArray(aud) ? aud : [aud]
  if (!auds.includes(expected.audience)) throw new Error('id_token audience mismatch')
  const exp = payload.exp
  if (typeof exp !== 'number' || exp <= (expected.nowSec ?? Math.floor(Date.now() / 1000))) {
    throw new Error('id_token expired')
  }
  if (payload.nonce !== expected.nonce) throw new Error('id_token nonce mismatch')
}

/** Maps validated id_token claims to the identity the login flow consumes. */
export function claimsFromPayload(
  payload: Record<string, unknown>,
  opts: { idToken: string; fallbackIssuer: string; groupsClaim: string },
): OidcClaims {
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const iss = typeof payload.iss === 'string' ? payload.iss : opts.fallbackIssuer
  const email = typeof payload.email === 'string' ? payload.email : `${sub}@users.local`
  const preferred = typeof payload.preferred_username === 'string' ? payload.preferred_username : ''
  const name = (typeof payload.name === 'string' ? payload.name : '') || preferred || email.split('@')[0] || sub
  if (!sub) throw new Error('id_token missing sub')
  return {
    sub,
    iss,
    email,
    name,
    idToken: opts.idToken,
    groups: normalizeGroupsClaim(payload[opts.groupsClaim]),
    authTime: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
    emailVerified: typeof payload.email === 'string' && payload.email_verified === true,
  }
}
