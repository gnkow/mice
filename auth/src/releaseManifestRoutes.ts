import type { Hono } from 'hono'
import { isInstanceAdmin } from './authzInstanceStore.js'
import {
  releaseManifestStatus,
  verifyAndRecordReleaseManifest,
} from './releaseManifest.js'
import type { AuditDep } from './routeDeps.js'
import { guarded } from './authentication/session/routeGuard.js'

const adminGate = async (u: { principalId?: number; sub: string; iss: string }) => {
  return (await isInstanceAdmin(u)) ? null : 'Instance admin required'
}

/**
 * Admin overview of the signed release manifest check (verified at start;
 * mismatch is audited and shown here).
 */
export function registerReleaseManifestRoutes(app: Hono, _deps: AuditDep): void {
  app.get(
    '/auth/admin/release-manifest/status',
    guarded({ gate: adminGate, mutates: false }, async ({ c }) => {
      const status = releaseManifestStatus()
      if (!status) {
        return c.json({
          present: false,
          signatureValid: null,
          match: null,
          mismatches: [],
          components: null,
          checkedAt: null,
          reason: 'Release manifest has not been checked yet (awaiting boot)',
        })
      }
      return c.json(status)
    }),
  )

  app.post(
    '/auth/admin/release-manifest/check',
    guarded({ gate: adminGate, mutates: false }, async ({ c }) => {
      const status = await verifyAndRecordReleaseManifest()
      return c.json({ ...status, rechecked: true })
    }),
  )
}
