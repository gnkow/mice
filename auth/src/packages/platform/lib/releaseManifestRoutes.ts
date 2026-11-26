import type { Hono } from 'hono'
import {
  releaseManifestStatus,
  verifyAndRecordReleaseManifest,
} from './releaseManifest.js'
import type { AuditDep } from '../../shared/index.js'
import { guarded } from '../../authentication/session.js'
import { adminRoleGate } from '../../authz/http.js'

/**
 * Admin overview of the signed release manifest check (verified at start;
 * mismatch is audited and shown here).
 */
export function registerReleaseManifestRoutes(app: Hono, _deps: AuditDep): void {
  app.get(
    '/auth/admin/release-manifest/status',
    guarded({ gate: adminRoleGate, mutates: false }, async ({ c }) => {
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
    guarded({ gate: adminRoleGate, mutates: false }, async ({ c }) => {
      const status = await verifyAndRecordReleaseManifest()
      return c.json({ ...status, rechecked: true })
    }),
  )
}
