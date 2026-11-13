import type { Hono } from 'hono'
import { isInstanceAdmin } from './authzInstanceStore.js'
import {
  effectiveRegulatedConfig,
  regulatedConfigDigest,
  regulatedConfigStatus,
} from './regulatedConfig.js'
import type { AuditDep } from './routeDeps.js'
import { guarded } from './authentication/session/routeGuard.js'

const adminGate = async (u: { principalId?: number; sub: string; iss: string }) => {
  return (await isInstanceAdmin(u)) ? null : 'Instance admin required'
}

/**
 * Admin overview of the effective regulated configuration (written to audit at start / change).
 */
export function registerRegulatedConfigRoutes(app: Hono, _deps: AuditDep): void {
  app.get(
    '/auth/admin/regulated-config',
    guarded({ gate: adminGate, mutates: false }, async ({ c }) => {
      const recorded = regulatedConfigStatus()
      const config = recorded?.config ?? effectiveRegulatedConfig()
      return c.json({
        config,
        digest: recorded?.digest ?? regulatedConfigDigest(config),
        recordedAt: recorded?.recordedAt ?? null,
        changedFromPrevious: recorded?.changedFromPrevious ?? null,
      })
    }),
  )
}
