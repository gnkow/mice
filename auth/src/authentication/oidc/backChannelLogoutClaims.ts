/**
 * Pure validation of a verified back-channel logout token payload (Ticket 06).
 * Signature / issuer / audience checks stay in verifyIdpJwt; this module owns
 * events, nonce refusal, and required claims before offboard + jti consume.
 */

const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

export type BackChannelLogoutClaims =
  | {
      ok: true
      sub: string
      iss: string
      jti: string
      iat: number
      /** Epoch seconds; omitted when the token has no exp (caller supplies a default). */
      exp?: number
    }
  | { ok: false; reason: string }

/** Decide whether a verified JWT payload is an acceptable back-channel logout token. */
export function decideBackChannelLogoutClaims(
  payload: Record<string, unknown>,
): BackChannelLogoutClaims {
  const events = payload.events
  if (!events || typeof events !== 'object' || !(LOGOUT_EVENT in (events as object))) {
    return { ok: false, reason: 'not a logout event' }
  }
  if ('nonce' in payload) {
    return { ok: false, reason: 'logout_token must not carry a nonce' }
  }
  const sub = payload.sub
  const iss = payload.iss
  const jti = payload.jti
  if (
    typeof sub !== 'string' ||
    !sub ||
    typeof iss !== 'string' ||
    !iss ||
    typeof payload.iat !== 'number' ||
    typeof jti !== 'string' ||
    !jti
  ) {
    return { ok: false, reason: 'sub, iss, iat and jti required' }
  }
  return {
    ok: true,
    sub,
    iss,
    jti,
    iat: payload.iat,
    ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
  }
}
