/**
 * Admin routes for IdP baseline drift detection (Ticket 23)
 */

import type { Hono } from 'hono'
import { isInstanceAdmin } from '../../../authz/index.js'
import { guarded } from '../session/routeGuard.js'
import { authorizeInstanceAction } from '../../../authz/index.js'
import {
  getCurrentBaseline,
  getCurrentIdpConfig,
  performDriftCheck,
  getRecentDriftReports,
  establishBaseline,
  assessDrift,
  type IdpDriftFetchDeps,
} from '../compliance/idpDriftDetection.js'
import { appendAudit } from '../../../audit/index.js'
import { requireAuditChange } from '../../../audit/change.js'
import { captureBefore } from '../../../audit/change.js'
import { env } from '../../../shared/index.js'

/** Baseline config as audit state (identity/timestamps excluded so re-establishing the same config is a no-op). */
function baselineSnapshot(config: {
  mfaClaimsAvailable: unknown
  requiredScopes: unknown
  signatureAlgorithm: unknown
  groupClaimFormat: unknown
  issuer: unknown
}): Record<string, unknown> {
  return {
    mfa_claims_available: config.mfaClaimsAvailable,
    required_scopes: config.requiredScopes,
    signature_algorithm: config.signatureAlgorithm,
    group_claim_format: config.groupClaimFormat,
    issuer: config.issuer,
  }
}

const requireInstanceAdmin = {
  gate: async (user: { sub: string; iss: string }) =>
    (await isInstanceAdmin(user)) ? null : 'Instance admin required',
  originCheck: true,
  jsonOnly: true,
} as const

/** Discovery/issuer ports for current/compare/check; production uses live fetch. */
export type IdpDriftRouteDeps = IdpDriftFetchDeps

export function registerIdpDriftRoutes(app: Hono, deps: IdpDriftRouteDeps = {}): void {
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
      const current = await getCurrentIdpConfig(deps)
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
      const report = await assessDrift({ ...deps, persist: false })
      if (report.error) {
        return c.json({
          error: 'Failed to compare configurations',
          detail: report.error,
        }, 503)
      }

      return c.json({
        baseline,
        current: report.currentConfig,
        hasCriticalDrift: report.hasCriticalDrift,
        hasNonCriticalDrift: report.hasNonCriticalDrift,
        criticalDrifts: report.criticalDrifts,
        nonCriticalDrifts: report.nonCriticalDrifts,
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
      const report = await performDriftCheck(deps)

      await appendAudit({
        actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
        via: 'session',
        method: 'POST',
        path: '/auth/admin/idp-drift/check',
        status: 200,
        action: 'idp_drift.check_performed',
        change: requireAuditChange(null, {
          report_id: report.id,
          has_critical_drift: report.hasCriticalDrift,
          has_non_critical_drift: report.hasNonCriticalDrift,
          critical_drifts: report.criticalDrifts,
          non_critical_drifts: report.nonCriticalDrifts,
        }),
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

    const mfaClaimsAvailable = body?.mfaClaimsAvailable as { acr?: string; amr: string[]; authTimeAsserted?: boolean } | undefined
    const requiredScopes = body?.requiredScopes as string[] | undefined
    const signatureAlgorithm = body?.signatureAlgorithm as string | undefined
    const groupClaimFormat = body?.groupClaimFormat as string | undefined

    if (!mfaClaimsAvailable || !requiredScopes || !signatureAlgorithm || !groupClaimFormat) {
      return c.json({
        error: 'Missing required fields',
        required: ['mfaClaimsAvailable', 'requiredScopes', 'signatureAlgorithm', 'groupClaimFormat'],
      }, 400)
    }

    const requested = baselineSnapshot({
      mfaClaimsAvailable,
      requiredScopes,
      signatureAlgorithm,
      groupClaimFormat,
      issuer: env.oidcIssuer,
    })
    const current = await captureBefore(() => getCurrentBaseline())
    const baselineChange = requireAuditChange(current ? baselineSnapshot(current) : null, requested)

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
        change: baselineChange,
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
