import type { Context } from 'hono'
import { offboard } from '../credentials/offboarding.js'
import { consumeBackChannelJti } from '../access/revocation.js'
import { decideBackChannelLogoutClaims } from './backChannelLogoutClaims.js'
import { verifyIdpJwt } from './oidc.js'

/**
 * OIDC Back-Channel Logout: a verified logout token ends the Principal's Sessions
 * (sessions-only cut-off at the token's `iat`, so a replay never ends a later Session).
 * PATs are untouched: logout is not offboarding.
 *
 * Claim validation lives in {@link decideBackChannelLogoutClaims}; this handler is the
 * Hono adapter (verify → decide → offboard → consume jti).
 */
export async function backChannelLogout(c: Context): Promise<Response> {
  const reject = (why: string) => {
    console.warn('[mice-auth] back-channel logout rejected:', why)
    return c.json({ error: 'invalid_request', error_description: why }, 400)
  }
  const form = await c.req.parseBody().catch(() => ({}))
  const token = (form as Record<string, unknown>).logout_token
  if (typeof token !== 'string' || !token) return reject('logout_token required')

  let payload: Record<string, unknown>
  try {
    payload = await verifyIdpJwt(token)
  } catch (e) {
    return reject(`logout_token failed verification: ${e instanceof Error ? e.message : e}`)
  }

  const claims = decideBackChannelLogoutClaims(payload)
  if (!claims.ok) return reject(claims.reason)

  const principal = { sub: claims.sub, iss: claims.iss }
  const result = await offboard(principal, {
    scope: 'sessions',
    cause: 'back-channel-logout',
    at: Math.min(claims.iat, Math.floor(Date.now() / 1000)),
    method: c.req.method,
    path: c.req.path,
    message: `IdP back-channel logout for ${claims.sub}`,
    strictAudit: true,
  })
  if (!result.ok) {
    return c.json({ error: 'server_error', error_description: 'audit unavailable' }, 503)
  }

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = claims.exp ?? now + 300
  if (!(await consumeBackChannelJti(claims.jti, expiresAt))) {
    return reject('logout_token replay')
  }

  c.header('Cache-Control', 'no-store')
  return c.body(null, 200)
}
