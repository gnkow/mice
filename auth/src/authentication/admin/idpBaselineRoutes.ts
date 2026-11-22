import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import { adminRoleGate } from '../../decisionHttp.js'
import {
  idpBaselineCheckAdminView,
  latestIdpBaselineCheck,
  listIdpBaselineChecks,
  recordIdpBaselineCheck,
} from './idpBaselineCheck.js'
import { env } from '../../env.js'
import type { AuditDep } from '../../routeDeps.js'

/**
 * IdP Baseline Validation Routes (Ticket 14)
 *
 * Admin endpoints for checking and viewing IdP MFA capability status.
 * Part 11 §11.200 requires MFA for signatures - these routes help admins
 * verify the IdP configuration meets requirements.
 *
 * Related:
 * - Round 8 decision U1: IdP MFA capability as deployment prerequisite
 * - .scratch/authentication/issues/14-idp-mfa-baseline-validation.md
 */

export function registerIdpBaselineRoutes(app: Hono, { audit }: AuditDep): void {
  /**
   * POST /auth/admin/idp-baseline/check
   *
   * Evaluate MFA evidence on the admin's current Session id_token and store the result.
   */
  app.post('/auth/admin/idp-baseline/check', guarded({
    gate: adminRoleGate,
    mutates: true,
  }, async ({ c, user }) => {
    try {
      const issuer = env.oidcIssuer
      const clientId = env.oidcClientId

      if (!issuer || !clientId) {
        await audit(c, user, 'session', {
          action: 'admin.idp_baseline_check',
          message: 'IdP baseline check failed: IdP not configured',
        })

        return c.json({
          error: 'IdP not configured - cannot perform baseline check',
          mfaAvailable: false,
        }, 500)
      }

      const check = await recordIdpBaselineCheck({
        idToken: user.idToken,
        checkedBy: `${user.iss}|${user.sub}`,
      })

      await audit(c, user, 'session', {
        action: 'admin.idp_baseline_check',
        message: 'IdP baseline check performed',
        detail: { checkId: check.id, issuer, mfaAvailable: check.mfaAvailable },
      })

      return c.json(idpBaselineCheckAdminView(check))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Baseline check failed'

      await audit(c, user, 'session', {
        action: 'admin.idp_baseline_check_failed',
        message: `IdP baseline check error: ${message}`,
      })

      return c.json({ error: message }, 500)
    }
  }))

  /**
   * GET /auth/admin/idp-baseline/status
   *
   * View the most recent IdP baseline check result.
   */
  app.get('/auth/admin/idp-baseline/status', guarded({
    gate: adminRoleGate,
    mutates: false,
  }, async ({ c }) => {
    const lastCheck = await latestIdpBaselineCheck()
    if (!lastCheck) {
      return c.json({
        lastCheck: null,
        message: 'No baseline checks performed yet',
      })
    }
    return c.json({ lastCheck })
  }))

  /**
   * GET /auth/admin/idp-baseline/history
   *
   * View all baseline check history (last 50 checks).
   */
  app.get('/auth/admin/idp-baseline/history', guarded({
    gate: adminRoleGate,
    mutates: false,
  }, async ({ c }) => {
    return c.json({ checks: await listIdpBaselineChecks(50) })
  }))
}
