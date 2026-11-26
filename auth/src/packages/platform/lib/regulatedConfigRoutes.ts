import type { Hono } from 'hono'
import {
  effectiveRegulatedConfig,
  regulatedConfigDigest,
  regulatedConfigStatus,
} from './regulatedConfig.js'
import type { AuditDep } from '../../shared/index.js'
import { guarded } from '../../authentication/session.js'
import { adminRoleGate } from '../../authz/http.js'

/**
 * Admin overview of the effective regulated configuration (written to audit at start / change).
 */
export function registerRegulatedConfigRoutes(app: Hono, _deps: AuditDep): void {
  app.get(
    '/auth/admin/regulated-config',
    guarded({ gate: adminRoleGate, mutates: false }, async ({ c }) => {
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
