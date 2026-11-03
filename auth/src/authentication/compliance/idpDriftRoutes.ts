/**
 * Admin routes for IdP baseline drift detection (Ticket 23)
 */

import type { Hono } from 'hono'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import { guarded } from '../session/routeGuard.js'
import { authorizeInstanceAction } from '../../authz.js'
import {
  getCurrentBaseline,
  getCurrentIdpConfig,
  performDriftCheck,
  getRecentDriftReports,
  establishBaseline,
  detectDrift,
} from '../compliance/idpDriftDetection.js'
import { appendAudit } from '../../audit.js'

const requireInstanceAdmin = {
  gate: async (user: { sub: string; iss: string }) =>
    (await isInstanceAdmin(user)) ? null : 'Instance admin required',
  originCheck: true,
  jsonOnly: true,
} as const

export function registerIdpDriftRoutes(app: Hono): void {
  /**
   * GET /auth/admin/idp-drift/baseline
   * Get current active baseline configuration
   */
  app.get('/auth/admin/idp-drift/baseline', guarded(requireInstanceAdmin, async ({ c, user }) => {
    await authorizeInstanceAction(user, 'instance.admin')

    const baseline = await getCurrentBaseline()

    if (!baseline) {
      return c.json({ error: 'No active baseline found' }, 404)
    }

    return c.json({ baseline })
  }))

  /**
   * GET /auth/admin/idp-drift/current
   * Get current IdP configuration
   */
  app.get('/auth/admin/idp-drift/current', guarded(requireInstanceAdmin, async ({ c, user }) => {
    await authorizeInstanceAction(user, 'instance.admin')

    try {
      const current = await getCurrentIdpConfig()
      return c.json({ current })
    } catch (err) {
      return c.json({
        error: 'Failed to fetch current IdP configuration',
        detail: err instanceof Error ? err.message : 'Unknown error',
      }, 503)
    }
  }))

  /**
   * GET /auth/admin/idp-drift/compare
   * Compare baseline vs current and show drift (without storing report)
   */
  app.get('/auth/admin/idp-drift/compare', guarded(requireInstanceAdmin, async ({ c, user }) => {
    await authorizeInstanceAction(user, 'instance.admin')

    const baseline = await getCurrentBaseline()
    if (!baseline) {
      return c.json({ error: 'No active baseline found' }, 404)
    }

    try {
      const current = await getCurrentIdpConfig()
      const { criticalDrifts, nonCriticalDrifts } = detectDrift(baseline, current)

      return c.json({
        baseline,
        current,
        hasCriticalDrift: criticalDrifts.length > 0,
        hasNonCriticalDrift: nonCriticalDrifts.length > 0,
        criticalDrifts,
        nonCriticalDrifts,
      })
    } catch (err) {
      return c.json({
        error: 'Failed to compare configurations',
        detail: err instanceof Error ? err.message : 'Unknown error',
      }, 503)
    }
  }))

  /**
   * POST /auth/admin/idp-drift/check
   * Perform drift check now and store report
   */
  app.post('/auth/admin/idp-drift/check', guarded(requireInstanceAdmin, async ({ c, user }) => {
    await authorizeInstanceAction(user, 'instance.admin')

    try {
      const report = await performDriftCheck()

      await appendAudit({
        actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
        via: 'session',
        method: 'POST',
        path: '/auth/admin/idp-drift/check',
        status: 200,
        action: 'idp_drift.check_performed',
        message: 'IdP drift check performed',
        detail: {
          reportId: report.id,
          hasCriticalDrift: report.hasCriticalDrift,
          hasNonCriticalDrift: report.hasNonCriticalDrift,
          criticalDrifts: report.criticalDrifts,
          nonCriticalDrifts: report.nonCriticalDrifts,
        },
      })

      return c.json({ report })
    } catch (err) {
      return c.json({
        error: 'Failed to perform drift check',
        detail: err instanceof Error ? err.message : 'Unknown error',
      }, 500)
    }
  }))

  /**
   * GET /auth/admin/idp-drift/reports
   * Get recent drift reports
   */
  app.get('/auth/admin/idp-drift/reports', guarded(requireInstanceAdmin, async ({ c, user }) => {
    await authorizeInstanceAction(user, 'instance.admin')

    const limit = Number(c.req.query('limit')) || 10
    const reports = await getRecentDriftReports(limit)

    return c.json({ reports })
  }))

  /**
   * POST /auth/admin/idp-drift/baseline
   * Establish new baseline (after reviewing drift as intentional)
   */
  app.post('/auth/admin/idp-drift/baseline', guarded({
    ...requireInstanceAdmin,
    body: 'json',
  }, async ({ c, user, body }) => {
    await authorizeInstanceAction(user, 'instance.admin')

    const mfaClaimsAvailable = body?.mfaClaimsAvailable as { acr?: string; amr: string[] } | undefined
    const requiredScopes = body?.requiredScopes as string[] | undefined
    const signatureAlgorithm = body?.signatureAlgorithm as string | undefined
    const groupClaimFormat = body?.groupClaimFormat as string | undefined

    if (!mfaClaimsAvailable || !requiredScopes || !signatureAlgorithm || !groupClaimFormat) {
      return c.json({
        error: 'Missing required fields',
        required: ['mfaClaimsAvailable', 'requiredScopes', 'signatureAlgorithm', 'groupClaimFormat'],
      }, 400)
    }

    try {
      const baseline = await establishBaseline(user.email, {
        mfaClaimsAvailable,
        requiredScopes,
        signatureAlgorithm,
        groupClaimFormat,
      })

      await appendAudit({
        actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
        via: 'session',
        method: 'POST',
        path: '/auth/admin/idp-drift/baseline',
        status: 200,
        action: 'idp_baseline.established',
        message: 'New IdP baseline established',
        detail: {
          baselineId: baseline.id,
          mfaClaimsAvailable,
          requiredScopes,
          signatureAlgorithm,
          groupClaimFormat,
        },
      })

      return c.json({ baseline })
    } catch (err) {
      return c.json({
        error: 'Failed to establish baseline',
        detail: err instanceof Error ? err.message : 'Unknown error',
      }, 500)
    }
  }))
}
