import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import { parsePrincipalKey, type PrincipalId } from '../session/principal.js'
import { revokeAll, suspend, confirmSuspension, listPendingSuspensions, selfSuspend } from '../access/revocation.js'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import type { AuditDep } from '../../routeDeps.js'

/**
 * Feature 5: Admin Revocation Routes
 * 
 * Exposes revocation and suspension functionality for admins.
 */

const adminGate = async (u: { principalId?: number; sub: string; iss: string }) => {
  return (await isInstanceAdmin(u)) ? null : 'Instance admin required'
}

export function registerAdminRevocationRoutes(app: Hono, { audit }: AuditDep): void {
  // Admin revoke-all
  app.post('/auth/admin/revoke', guarded({ 
    gate: adminGate, 
    mutates: true, 
    body: { required: ['principal', 'reason'] } 
  }, async ({ c, user, body }) => {
    const principalKey = String(body.principal)
    const reason = String(body.reason)

    let principal: PrincipalId
    try {
      principal = parsePrincipalKey(principalKey)
    } catch {
      return c.json({ error: 'Invalid principal format (use iss|sub or email)' }, 400)
    }

    try {
      await revokeAll(principal, {
        revokedBy: { iss: user.iss, sub: user.sub },
        reason,
      })

      await audit(c, user, 'session', {
        action: 'admin.revoke_all',
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
    gate: adminGate,
    mutates: true,
    body: { required: ['principal', 'reason'] }
  }, async ({ c, user, body }) => {
    const principalKey = String(body.principal)
    const reason = String(body.reason)

    let principal: PrincipalId
    try {
      principal = parsePrincipalKey(principalKey)
    } catch {
      return c.json({ error: 'Invalid principal format (use iss|sub or email)' }, 400)
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
      message: `Initiated suspension for ${principalKey}`,
      detail: { principal: principalKey, reason, requestId },
    })

    return c.json({ ok: true, requestId, expiresIn: 24 * 60 * 60 })
  }))

  // Confirm suspension (second admin)
  app.post('/auth/admin/suspend/:requestId/confirm', guarded({
    gate: adminGate,
    mutates: true,
    body: { required: ['reason'] }
  }, async ({ c, user, body }) => {
    const requestId = c.req.param('requestId')
    const reason = String(body.reason)

    try {
      await confirmSuspension(requestId, {
        confirmedBy: { iss: user.iss, sub: user.sub },
        reason,
      })

      await audit(c, user, 'session', {
        action: 'admin.suspend_confirmed',
        message: `Confirmed suspension request ${requestId}`,
        detail: { requestId, reason },
      })

      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof Error) {
        if ('status' in err && err.status === 503) {
          return c.json({ error: 'Audit system unavailable - suspension blocked' }, 503)
        }
        if (err.message.includes('not found')) {
          return c.json({ error: 'Suspension request not found or expired' }, 404)
        }
        if (err.message.includes('same admin')) {
          return c.json({ error: 'Cannot confirm your own suspension request' }, 400)
        }
      }
      throw err
    }
  }))

  // Panic: a Principal suspends their own account immediately.
  app.post('/auth/me/suspend', guarded({
    mutates: true,
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
    gate: adminGate
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
