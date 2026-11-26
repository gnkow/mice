import type { Hono } from 'hono'
import { guarded } from '../../authentication/session.js'
import type { AuditDep } from '../../shared/index.js'
import { EMPTY_AUDIT_CHANGE, requireAuditChange } from '../../audit/change.js'
import { captureBefore } from '../../audit/change.js'
import { recordRestoreTestPassed, loadRestoreTestStatus } from './restoreTestGate.js'
import { runCrossStoreIntegrity } from './crossStoreIntegrity.js'

/**
 * Platform ops routes that previously lived in mergeRequestRoutes (accidental flatness).
 * Restore-test gate + cross-store integrity check.
 */
export function registerOpsRoutes(app: Hono, { audit: _unused }: AuditDep): void {
  void _unused
  // GxP ticket 15 — operator records a passing restore test.
  app.post(
    '/auth/admin/restore-test/pass',
    guarded(
      { mutates: true, action: 'system.restore_test.passed', body: 'optional' },
      async ({ c, user, audit }) => {
        const { isInstanceAdmin } = await import('../../authz/index.js')
        if (!(await isInstanceAdmin(user))) return c.json({ error: 'Instance admin required' }, 403)
        const beforeRestore = await captureBefore(() => loadRestoreTestStatus())
        const status = await recordRestoreTestPassed({
          recordedBy: `${user.iss}|${user.sub}`,
        })
        await audit({
          action: 'system.restore_test.passed',
          change: requireAuditChange({ ...beforeRestore }, { ...status }),
          message: 'Operator recorded restore test pass',
          detail: status,
        })
        return c.json({ restoreTest: status })
      },
    ),
  )

  app.get(
    '/auth/admin/restore-test',
    guarded({}, async ({ c, user }) => {
      const { isInstanceAdmin } = await import('../../authz/index.js')
      if (!(await isInstanceAdmin(user))) return c.json({ error: 'Instance admin required' }, 403)
      return c.json({ restoreTest: await loadRestoreTestStatus() })
    }),
  )

  // GxP ticket 19 — report-only integrity run.
  app.post(
    '/auth/admin/integrity-check',
    guarded(
      { mutates: true, action: 'system.integrity_check', body: 'optional' },
      async ({ c, user, audit }) => {
        const { isInstanceAdmin } = await import('../../authz/index.js')
        if (!(await isInstanceAdmin(user))) return c.json({ error: 'Instance admin required' }, 403)
        const report = await runCrossStoreIntegrity({ notify: async () => {} })
        await audit({
          action: 'system.integrity_check',
          // Report-only run: it records findings but changes no stored state.
          change: EMPTY_AUDIT_CHANGE,
          message: `Integrity check ${report.runId}`,
          detail: { findings: report.findings.length },
        })
        return c.json({ report })
      },
    ),
  )
}
