import type { Hono } from 'hono'
import { auditReadiness, verifyAudit } from './audit.js'
import {
  closeAuditOutage,
  currentAuditOutage,
  immudbHaStatus,
  listAuditOutages,
  reportAuditDegradation,
} from './auditOutage.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
import { currentClock } from './clock.js'
import type { AuditDep } from './routeDeps.js'
import { guarded } from './authentication/session/routeGuard.js'

const adminGate = async (u: { principalId?: number; sub: string; iss: string }) => {
  return (await isInstanceAdmin(u)) ? null : 'Instance admin required'
}

async function statusPayload() {
  const [readiness, outage, recentOutages] = await Promise.all([
    auditReadiness(),
    currentAuditOutage(),
    listAuditOutages(20),
  ])
  return {
    readiness,
    ha: immudbHaStatus(),
    currentOutage: outage,
    recentOutages,
  }
}

/**
 * Admin probe for audit (immudb) availability, HA attestation, and outage incidents.
 * Mirrors the IdP baseline/outage pattern: status for operators, check to re-probe.
 */
export function registerAuditHealthRoutes(app: Hono, _deps: AuditDep): void {
  app.get(
    '/auth/admin/audit-health/status',
    guarded({ gate: adminGate, mutates: false }, async ({ c }) => c.json(await statusPayload())),
  )

  /**
   * Re-verifies the ledger and records/closes an outage incident. Does not mutate regulated
   * data and must work while immudb is down (no Intent write).
   */
  app.post(
    '/auth/admin/audit-health/check',
    guarded({ gate: adminGate, mutates: false }, async ({ c }) => {
      const at = currentClock.now()
      const requestId = c.req.header('x-request-id') || `audit-health-${at}`
      let verification: Awaited<ReturnType<typeof verifyAudit>>
      try {
        verification = await verifyAudit()
      } catch (err) {
        verification = {
          ok: false,
          events: 0,
          verifiedAt: new Date(at).toISOString(),
          firstBreak: { seq: 0, reason: String(err) },
        }
      }
      const readiness = await auditReadiness()
      const degraded = !readiness.ok || !verification.ok
      if (degraded) {
        await reportAuditDegradation({
          at,
          check: 'admin_check',
          requestId,
          detail: readiness.detail || verification.firstBreak?.reason,
        })
      } else {
        await closeAuditOutage(at)
      }
      return c.json({
        ...(await statusPayload()),
        verification: {
          ok: verification.ok,
          events: verification.events,
          verifiedAt: verification.verifiedAt,
          ...(verification.ok ? {} : { firstBreak: verification.firstBreak }),
        },
        checkedAt: new Date(at).toISOString(),
      })
    }),
  )
}
