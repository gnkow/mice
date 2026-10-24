import type { Context } from 'hono'
import { offboard } from './offboarding.js'
import { verifyIdpJwt } from './oidc.js'

const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

/**
 * OIDC Back-Channel Logout: a verified logout token ends the Principal's Sessions
 * (sessions-only cut-off at the token's `iat`, so a replay never ends a later Session).
 * PATs are untouched: logout is not offboarding.
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
  const events = payload.events as Record<string, unknown> | undefined
  if (!events || typeof events !== 'object' || !(LOGOUT_EVENT in events)) {
    return reject('not a logout event')
  }
  if ('nonce' in payload) return reject('logout_token must not carry a nonce')
  const sub = payload.sub
  const iss = payload.iss
  if (typeof sub !== 'string' || !sub || typeof iss !== 'string' || typeof payload.iat !== 'number') {
    return reject('sub, iss and iat required')
  }

  const principal = { sub, iss }
  offboard(principal, {
    scope: 'sessions',
    cause: 'back-channel-logout',
    at: Math.min(payload.iat, Math.floor(Date.now() / 1000)),
    method: c.req.method,
    path: c.req.path,
    message: `IdP back-channel logout for ${sub}`,
  })
  c.header('Cache-Control', 'no-store')
  return c.body(null, 200)
}
