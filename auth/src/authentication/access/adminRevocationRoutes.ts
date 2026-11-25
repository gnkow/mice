import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import { canonicalIssuer, type PrincipalId } from '../session/principal.js'
import {
  revokeAll,
  suspend,
  confirmSuspension,
  listPendingSuspensions,
  selfSuspend,
  SuspensionConfirmError,
} from '../access/revocation.js'
import { adminRoleGate } from '../../decisionHttp.js'
import type { AuditDep } from '../../routeDeps.js'
import { requireAuditChange } from '../../auditChange.js'
import { captureBefore } from '../../auditCapture.js'
import { principalAccessAuditSnapshot } from './accessAudit.js'

/**
 * Feature 5: Admin Revocation Routes
 * 
 * Exposes revocation and suspension functionality for admins.
 */

/** Split `iss|sub` on the first bar (same convention as Mice suspension / directory pick). */
function principalFrom(raw: string): PrincipalId | null {
  const bar = raw.indexOf('|')
  if (bar <= 0 || bar === raw.length - 1) return null
  return { iss: canonicalIssuer(raw.slice(0, bar)), sub: raw.slice(bar + 1) }
}

export function registerAdminRevocationRoutes(app: Hono, { audit }: AuditDep): void {
  // Admin revoke-all (GxP ticket 03: revocation class → reason + ceremony)
  app.post('/auth/admin/revoke', guarded({ 
    gate: adminRoleGate, 
    mutates: true,
    reason: true,
    body: { required: ['principal', 'reason'] } 
  }, async ({ c, user, body }) => {
    const principalKey = String(body.principal)
    const reason = String(body.reason)

    const principal = principalFrom(principalKey)
    if (!principal) {
      return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    }

    try {
      const before = await captureBefore(() => principalAccessAuditSnapshot(principal))
      await revokeAll(principal, {
        revokedBy: { iss: user.iss, sub: user.sub },
        reason,
      })

      await audit(c, user, 'session', {
        action: 'admin.revoke_all',
        change: requireAuditChange(before, await principalAccessAuditSnapshot(principal)),
        message: `Revoked all sessions for ${principalKey}`,
        detail: { principal: principalKey, reason },
      })

      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof Error && 'status' in err && err.status === 503) {
        return c.json({ error: 'Audit system unavailable - revocation blocked' }, 503)
      }
      throw err
    }
  }))

  // Security-role suspension (requires confirmation within 24h)
  app.post('/auth/admin/suspend', guarded({
    gate: adminRoleGate,
    mutates: true,
    reason: true,
    body: { required: ['principal', 'reason'] }
  }, async ({ c, user, body }) => {
    const principalKey = String(body.principal)
    const reason = String(body.reason)

    const principal = principalFrom(principalKey)
    if (!principal) {
      return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    }

    let requestId: string
    try {
      requestId = await suspend(principal, {
        suspendedBy: { iss: user.iss, sub: user.sub },
        reason,
      })
    } catch (err) {
      if (err instanceof Error && 'status' in err && err.status === 503) {
        return c.json({ error: 'Audit system unavailable - suspension blocked' }, 503)
      }
      throw err
    }

    await audit(c, user, 'session', {
      action: 'admin.suspend_initiated',
      // A suspension request is a created record; the suspension itself lands on confirm.
      change: requireAuditChange(null, {
        suspension_id: requestId,
        principal: principalKey,
        suspended_by: `${user.iss}|${user.sub}`,
        expires_in_sec: 24 * 60 * 60,
      }),
      message: `Initiated suspension for ${principalKey}`,
      detail: { principal: principalKey, reason, requestId },
    })

    return c.json({ ok: true, requestId, expiresIn: 24 * 60 * 60 })
  }))

  // Confirm suspension (second admin)
  app.post('/auth/admin/suspend/:requestId/confirm', guarded({
    gate: adminRoleGate,
    mutates: true,
    reason: true,
    body: { required: ['reason'] }
  }, async ({ c, user, body }) => {
    const requestId = c.req.param('requestId')
    const reason = String(body.reason)

    try {
      const pending = (await captureBefore(() => listPendingSuspensions())).find((s) => s.id === requestId)
      const before = pending
        ? { ...(await captureBefore(() => principalAccessAuditSnapshot(pending.principal))), request_confirmed: false }
        : null
      await confirmSuspension(requestId, {
        confirmedBy: { iss: user.iss, sub: user.sub },
        reason,
      })
      // An unknown/expired request makes confirmSuspension throw (404) before this point.
      const after = pending
        ? { ...(await principalAccessAuditSnapshot(pending.principal)), request_confirmed: true }
        : null

      await audit(c, user, 'session', {
        action: 'admin.suspend_confirmed',
        change: requireAuditChange(before, after),
        message: `Confirmed suspension request ${requestId}`,
        detail: { requestId, reason },
      })

      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof Error && 'status' in err && err.status === 503) {
        return c.json({ error: 'Audit system unavailable - suspension blocked' }, 503)
      }
      if (err instanceof SuspensionConfirmError) {
        if (err.code === 'not_found') {
          return c.json({ error: 'Suspension request not found or expired' }, 404)
        }
        return c.json({ error: 'Cannot confirm your own suspension request' }, 400)
      }
      throw err
    }
  }))

  // Panic: a Principal suspends their own account immediately.
  app.post('/auth/me/suspend', guarded({
    mutates: true,
    reason: true,
    body: { required: ['reason'] }
  }, async ({ c, user, body }) => {
    try {
      await selfSuspend({ iss: user.iss, sub: user.sub }, { reason: String(body.reason) })
    } catch (err) {
      if (err instanceof Error && 'status' in err && err.status === 503) {
        return c.json({ error: 'Audit system unavailable - suspension blocked' }, 503)
      }
      throw err
    }
    return c.json({ ok: true })
  }))

  // List pending suspensions
  app.get('/auth/admin/suspensions/pending', guarded({
    gate: adminRoleGate
  }, async ({ c }) => {
    const pending = await listPendingSuspensions()
    return c.json({
      suspensions: pending.map(s => ({
        id: s.id,
        principal: `${s.principal.iss}|${s.principal.sub}`,
        suspendedBy: `${s.suspendedBy.iss}|${s.suspendedBy.sub}`,
        reason: s.reason,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
    })
  }))
}
