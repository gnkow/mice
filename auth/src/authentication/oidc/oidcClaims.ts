import { normalizeGroupsClaim } from '../../authzTypes.js'

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
  /** True when IdP indicates group overage (too many groups to fit in claims). */
  groupsOverage?: boolean
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

/** Clock leeway for id_token validity times (`exp`, `nbf`) only; never applied to login state or Sessions. */
export const ID_TOKEN_LEEWAY_SEC = 5 * 60

/**
 * Claim checks for an id_token received directly from the token endpoint over TLS.
 * The JWS signature is verified separately, always.
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
  const now = expected.nowSec ?? Math.floor(Date.now() / 1000)
  if (typeof exp !== 'number' || exp + ID_TOKEN_LEEWAY_SEC <= now) throw new Error('id_token expired')
  const nbf = payload.nbf
  if (typeof nbf === 'number' && nbf - ID_TOKEN_LEEWAY_SEC > now) throw new Error('id_token not yet valid')
  if (payload.nonce !== expected.nonce) throw new Error('id_token nonce mismatch')
}

/**
 * Detect group overage indicator in IdP claims (Ticket 18, U17).
 * 
 * Entra ID sends `_claim_names` with a `groups` entry when the user has too many
 * groups to fit in the id_token. Other IdPs may use different indicators.
 * 
 * Example Entra overage claim:
 * ```json
 * {
 *   "_claim_names": {
 *     "groups": "src1"
 *   },
 *   "_claim_sources": {
 *     "src1": {
 *       "endpoint": "https://graph.microsoft.com/v1.0/users/{id}/getMemberObjects"
 *     }
 *   }
 * }
 * ```
 */
export function hasGroupOverage(payload: Record<string, unknown>, groupsClaim: string): boolean {
  // Check if the groups claim is present and populated
  const groupsValue = payload[groupsClaim]
  const hasGroups = Array.isArray(groupsValue) && groupsValue.length > 0
  
  // Entra ID overage indicator: _claim_names.groups exists
  const claimNames = payload._claim_names
  if (claimNames && typeof claimNames === 'object' && claimNames !== null) {
    const names = claimNames as Record<string, unknown>
    if ('groups' in names) {
      return true
    }
  }
  
  // If we have groups in the claim, it's not an overage situation
  if (hasGroups) {
    return false
  }
  
  // Check for _claim_sources (another overage indicator)
  const claimSources = payload._claim_sources
  if (claimSources && typeof claimSources === 'object' && claimSources !== null) {
    // If claim_sources exists but no groups, likely overage
    return true
  }
  
  return false
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
  
  const groupsOverage = hasGroupOverage(payload, opts.groupsClaim)
  const groups = groupsOverage ? [] : normalizeGroupsClaim(payload[opts.groupsClaim])
  
  return {
    sub,
    iss,
    email,
    name,
    idToken: opts.idToken,
    groups,
    authTime: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
    emailVerified: typeof payload.email === 'string' && payload.email_verified === true,
    ...(groupsOverage ? { groupsOverage: true } : {}),
  }
}
