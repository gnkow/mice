import type { Hono } from 'hono'
import { env } from './env.js'
import { parsePatScopes } from './patScopes.js'
import { guarded, type GuardPolicy } from './routeGuard.js'
import type { AuditDep } from './routeDeps.js'
import { authorizeCliDeviceApprove, isPendingUser, preparePrincipal } from './authz.js'
import { isAuthzEnforce, isInstanceAdmin } from './authzInstanceStore.js'
import { userHasAnyGrant } from './authzVisibility.js'
import { approveDevice, denyDevice, lookupDeviceByUserCode, pollDevice, startDeviceAuth } from './cliDevice.js'
import { findPatByToken, revokePatByToken } from './tokens.js'
import { bearerToken, resolveBearer } from './requireAuth.js'
import type { SessionUser } from './session.js'

/** Public CLI remote hint and the device-login pairing flow (no IdP device grant required). */
export function registerCliDeviceRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
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
      loginExample: 'mice login',
      cloneExample: `mice clone ${remote}/<namespace>/<repo>`,
      /** Automation / CI still use a manually minted PAT. */
      configExample: `oxen config --auth ${authHost} <PAT>`,
      oxenCloneExample: `oxen clone ${remote}/<namespace>/<repo>`,
    })
  })

  // --- CLI device login (Mice-native pairing; no IdP device grant required) ---

  app.post('/auth/cli/device/start', async (c) => {
    let raw: unknown
    try {
      raw = ((await c.req.json()) as { scopes?: unknown }).scopes
    } catch {
      /* empty body ok */
    }
    const parsed = parsePatScopes(raw)
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)
    const started = startDeviceAuth(parsed.scopes)
    return c.json(started)
  })

  /** Redirect browser to the web UI approve page. */
  app.get('/auth/cli/device', (c) => {
    const userCode = c.req.query('user_code') ?? ''
    const target = new URL(`${env.publicWebOrigin}/cli/device`)
    if (userCode) target.searchParams.set('user_code', userCode)
    return c.redirect(target.toString())
  })

  app.get('/auth/cli/device/status', guarded({ credential: 'session' }, ({ c }) => {
    const userCode = c.req.query('user_code') ?? ''
    if (!userCode.trim()) return c.json({ error: 'user_code required' }, 400)
    const lookup = lookupDeviceByUserCode(userCode)
    if (!lookup) return c.json({ error: 'Unknown user code' }, 404)
    return c.json(lookup)
  }))

  const approverGate = (user: SessionUser) => {
    const gate = authorizeCliDeviceApprove(user)
    return gate.allow ? null : (gate.reason ?? 'Forbidden')
  }
  const deviceBody: GuardPolicy = { credential: 'session', gate: approverGate, body: { required: ['user_code'] } }

  app.post('/auth/cli/device/approve', guarded(deviceBody, ({ c, user: session, body }) => {
    const userCode = String(body.user_code)
    if (!userCode.trim()) return c.json({ error: 'user_code required' }, 400)
    const result = approveDevice(userCode, session)
    if (!result.ok) {
      const status = result.status === 404 ? 404 : 400
      return c.json({ error: result.error }, status)
    }
    auditMutation(c, session, 'session', {
      action: 'device.approve',
      message: `Approved device login: ${result.userCode}`,
      detail: { userCode: result.userCode },
    })
    return c.json({ ok: true, user_code: result.userCode })
  }))

  app.post('/auth/cli/device/deny', guarded(deviceBody, ({ c, user: session, body }) => {
    const userCode = String(body.user_code)
    if (!userCode.trim()) return c.json({ error: 'user_code required' }, 400)
    const result = denyDevice(userCode)
    if (!result.ok) {
      const status = result.status === 404 ? 404 : 400
      return c.json({ error: result.error }, status)
    }
    auditMutation(c, session, 'session', {
      action: 'device.deny',
      message: `Denied device login: ${userCode.trim().toUpperCase()}`,
      detail: { userCode: userCode.trim().toUpperCase() },
    })
    return c.json({ ok: true })
  }))

  app.post('/auth/cli/device/poll', async (c) => {
    let deviceCode = ''
    try {
      const body = (await c.req.json()) as { device_code?: string }
      deviceCode = body.device_code ?? ''
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!deviceCode.trim()) return c.json({ error: 'device_code required' }, 400)
    const result = pollDevice(deviceCode)
    if (result.status === 'authorization_pending') {
      return c.json({ status: 'authorization_pending' }, 400)
    }
    if (result.status === 'slow_down') {
      return c.json(
        { status: 'slow_down', interval: result.interval },
        400,
      )
    }
    if (result.status === 'expired_token') {
      return c.json({ status: 'expired_token', error: 'expired_token' }, 400)
    }
    if (result.status === 'access_denied') {
      return c.json({ status: 'access_denied', error: 'access_denied' }, 400)
    }
    if (result.status === 'error') {
      return c.json({ status: 'error', error: result.error }, 400)
    }
    auditMutation(c, result.user, 'pat', {
      action: 'device.redeem',
      message: 'CLI device login completed; token issued',
      detail: { patId: result.patId },
    })
    return c.json({
      status: 'approved',
      access_token: result.token,
      token: result.token,
      pat_id: result.patId,
      remote: result.remote,
      auth_host: result.authHost,
      user: result.user,
    })
  })

  app.post('/auth/cli/logout', async (c) => {
    const bearer = bearerToken(c)
    if (!bearer) return c.json({ error: 'Bearer token required' }, 401)
    const user = resolveBearer(c)
    const ok = revokePatByToken(bearer)
    if (!ok) return c.json({ error: 'Token not found' }, 404)
    if (user) {
      auditMutation(c, user, 'pat', {
        action: 'token.revoke',
        message: 'Revoked token via CLI logout',
      })
    }
    return c.json({ ok: true })
  })

  app.get('/auth/cli/whoami', async (c) => {
    const bearer = bearerToken(c)
    if (!bearer) return c.json({ error: 'Bearer token required' }, 401)
    const user = resolveBearer(c)
    if (!user) return c.json({ error: 'Invalid token' }, 401)
    preparePrincipal(user)
    const pat = findPatByToken(bearer)
    const pending = isPendingUser(user)
    return c.json({
      authenticated: true,
      user: {
        sub: user.sub,
        iss: user.iss,
        email: user.email,
        name: user.name,
      },
      pat: pat
        ? { id: pat.id, label: pat.label, source: pat.source ?? 'manual' }
        : null,
      authz: {
        enforce: isAuthzEnforce(),
        pending,
        instanceAdmin: isInstanceAdmin(user),
        hasAnyGrant: userHasAnyGrant(user),
      },
      remote: env.publicOxenRemote,
    })
  })
}
