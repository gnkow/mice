import type { Hono } from 'hono'
import { env } from '../../env.js'
import { parseCliScopes } from './cliScopes.js'
import { guarded, type GuardPolicy } from '../session/routeGuard.js'
import type { AuditDep } from '../../routeDeps.js'
import { authorizeCliDeviceApprove, isPendingUser, preparePrincipal } from '../../authz.js'
import { getUserRole } from '../../rbacStore.js'
import { approveDevice, denyDevice, lookupDeviceByUserCode, pollDevice, startDeviceAuth } from './cliDevice.js'
import { cliRefreshReply, logoutCliCredential, refreshCliCredential } from './cliCredentials.js'
import { bearerToken, resolveBearer } from '../session/requireAuth.js'
import type { SessionUser } from '../session/session.js'
import { getDisplaySuffix, hashFromHeaders } from '../../ipHash.js'
import { beginDeviceApproval } from './deviceApprovalRateLimit.js'
import { decideDeviceApprovalConfirmation } from './deviceApprovalConfirmation.js'
import { enforceIpRateLimit } from '../rateLimit/rateLimitMiddleware.js'
import { RATE_LIMIT_CONFIG } from '../rateLimit/rateLimit.js'

/** Public CLI remote hint and the device-login pairing flow (no IdP device grant required). */
export function registerCliDeviceRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  /** Public CLI remote hint (no secrets). */
  app.get('/auth/cli-info', async (c) => {
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
    const limited = await enforceIpRateLimit(c, RATE_LIMIT_CONFIG.deviceFlow)
    if (limited) return limited
    let raw: unknown
    let deviceName: string | undefined
    try {
      const body = (await c.req.json()) as { scopes?: unknown; device_name?: unknown }
      raw = body.scopes
      deviceName = typeof body.device_name === 'string' ? body.device_name : undefined
    } catch {
      /* empty body ok */
    }
    const parsed = parseCliScopes(raw)
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)
    
    const requestHashedIp = await hashFromHeaders(c.req.raw.headers)
    const started = await startDeviceAuth(parsed.scopes, {
      deviceName,
      requestHashedIp: requestHashedIp ?? undefined,
    })
    return c.json(started)
  })

  /** Redirect browser to the web UI approve page. */
  app.get('/auth/cli/device', async (c) => {
    const userCode = c.req.query('user_code') ?? ''
    const target = new URL(`${env.publicWebOrigin}/cli/device`)
    if (userCode) target.searchParams.set('user_code', userCode)
    return c.redirect(target.toString())
  })

  app.get('/auth/cli/device/status', guarded({ credential: 'session' }, async ({ c }) => {
    const userCode = c.req.query('user_code') ?? ''
    if (!userCode.trim()) return c.json({ error: 'user_code required' }, 400)
    const lookup = await lookupDeviceByUserCode(userCode)
    if (!lookup) return c.json({ error: 'Unknown user code' }, 404)
    // Display path: only the last 4 hex chars leave the auth seam (Ticket 16).
    return c.json({
      ...lookup,
      ...(lookup.requestHashedIp
        ? { requestHashedIp: getDisplaySuffix(lookup.requestHashedIp) ?? undefined }
        : {}),
    })
  }))

  const approverGate = async (user: SessionUser) => {
    const gate = await authorizeCliDeviceApprove(user)
    return gate.allow ? null : (gate.reason ?? 'Forbidden')
  }
  const deviceBody: GuardPolicy = { credential: 'session', gate: approverGate, body: { required: ['user_code'] } }

  app.post('/auth/cli/device/approve', guarded({ ...deviceBody, mutates: true }, async ({ c, user: session, body }) => {
    const confirmation = decideDeviceApprovalConfirmation(body.confirmation, body.user_code)
    if (!confirmation.ok) return c.json({ error: confirmation.error }, confirmation.status)
    const userCode = confirmation.userCode

    // Ticket 25: Rate limiting (5 approvals per 10 minutes)
    const gate = await beginDeviceApproval(session)
    if (!gate.allowed) {
      return c.json({
        error: `Too many device approvals. Limit: 5 per ${gate.windowMinutes} minutes. Current: ${gate.count}`,
        count: gate.count,
        limit: 5,
      }, 429)
    }

    const result = await approveDevice(userCode, session)
    if (!result.ok) {
      const status = result.status === 404 ? 404 : 400
      return c.json({ error: result.error }, status)
    }

    const approverHashedIp = await hashFromHeaders(c.req.raw.headers)
    const { shouldAlert, count, securityWarning } = await gate.commit(
      result.userCode,
      approverHashedIp,
    )
    if (securityWarning) {
      console.warn(securityWarning)
    }

    await auditMutation(c, session, 'session', {
      action: 'device.approve',
      message: `Approved device login: ${result.userCode}`,
      detail: {
        userCode: result.userCode,
        approvalCount: count,
        alertTriggered: shouldAlert,
      },
      hashed_ip: approverHashedIp ?? undefined,
    })

    return c.json({ ok: true, user_code: result.userCode })
  }))

  app.post('/auth/cli/device/deny', guarded(deviceBody, async ({ c, user: session, body }) => {
    const userCode = String(body.user_code)
    if (!userCode.trim()) return c.json({ error: 'user_code required' }, 400)
    const result = await denyDevice(userCode)
    if (!result.ok) {
      const status = result.status === 404 ? 404 : 400
      return c.json({ error: result.error }, status)
    }
    await auditMutation(c, session, 'session', {
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
    const result = await pollDevice(deviceCode)
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
    await auditMutation(c, result.user, 'pat', {
      action: 'device.redeem',
      message: 'CLI device login completed; token issued',
      detail: { expiresIn: result.expiresIn },
    })
    return c.json({
      status: 'approved',
      access_token: result.token,
      token: result.token,
      refresh_token: result.refreshToken,
      expires_in: result.expiresIn,
      remote: result.remote,
      auth_host: result.authHost,
      user: result.user,
    })
  })

  app.post('/auth/cli/refresh', async (c) => {
    const limited = await enforceIpRateLimit(c, RATE_LIMIT_CONFIG.refresh)
    if (limited) return limited
    let refreshToken = ''
    try {
      const body = (await c.req.json()) as { refresh_token?: string }
      refreshToken = body.refresh_token ?? ''
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!refreshToken.trim()) return c.json({ error: 'refresh_token required' }, 400)
    const reply = cliRefreshReply(await refreshCliCredential(refreshToken))
    return c.json(reply.body, reply.status)
  })

  app.post('/auth/cli/logout', async (c) => {
    const bearer = bearerToken(c)
    if (!bearer) return c.json({ error: 'Bearer token required' }, 401)
    const user = await resolveBearer(c)
    const ok = await logoutCliCredential(bearer)
    if (!ok) return c.json({ error: 'Token not found' }, 404)
    if (user) {
      await auditMutation(c, user, 'pat', {
        action: 'token.revoke',
        message: 'Revoked token via CLI logout',
      })
    }
    return c.json({ ok: true })
  })

  app.get('/auth/cli/whoami', async (c) => {
    const bearer = bearerToken(c)
    if (!bearer) return c.json({ error: 'Bearer token required' }, 401)
    const user = await resolveBearer(c)
    if (!user) return c.json({ error: 'Invalid token' }, 401)
    await preparePrincipal(user)
    const pending = await isPendingUser(user)
    return c.json({
      authenticated: true,
      user: {
        sub: user.sub,
        iss: user.iss,
        email: user.email,
        name: user.name,
      },
      authz: {
        enforce: true,
        pending,
        role: await getUserRole(user),
      },
      remote: env.publicOxenRemote,
    })
  })
}
