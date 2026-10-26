import type { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { guarded } from '../session/routeGuard.js'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import { getDb } from '../../db/database.js'
import { idpBaselineChecks } from '../../db/schema.js'
import { extractMfaEvidence } from '../signing/mfaEvidence.js'
import { decodeJwtPayload } from '../oidc/oidcClaims.js'
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

const adminGate = async (u: { principalId?: number; sub: string; iss: string }) => {
  return (await isInstanceAdmin(u)) ? null : 'Instance admin required'
}

export function registerIdpBaselineRoutes(app: Hono, { audit }: AuditDep): void {
  /**
   * POST /auth/admin/idp-baseline/check
   * 
   * Manually trigger an IdP MFA capability check.
   * This performs a test authentication to verify the IdP provides MFA claims (acr/amr).
   */
  app.post('/auth/admin/idp-baseline/check', guarded({
    gate: adminGate,
    mutates: true,
  }, async ({ c, user }) => {
    try {
      // For now, we'll check if the IdP is configured and return a placeholder
      // In a full implementation, this would perform a test authentication flow
      // to extract claims from a real id_token
      
      // Check if OIDC is configured
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

      // TODO: Perform actual test authentication to extract MFA claims
      // For now, we'll create a baseline check record indicating the check was attempted
      const principalKey = `${user.iss}|${user.sub}`
      
      // Insert baseline check result
      const [check] = await getDb()
        .insert(idpBaselineChecks)
        .values({
          checkedBy: principalKey,
          mfaAvailable: false, // Will be true once we implement real check
          claimsFound: null,
          error: 'Test authentication not yet implemented - manual verification required',
        })
        .returning()

      await audit(c, user, 'session', {
        action: 'admin.idp_baseline_check',
        message: 'IdP baseline check performed',
        detail: { checkId: check.id, issuer },
      })

      return c.json({
        id: check.id,
        checkedAt: check.checkedAt,
        checkedBy: check.checkedBy,
        mfaAvailable: check.mfaAvailable,
        claimsFound: check.claimsFound,
        error: check.error,
      })
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
    gate: adminGate,
    mutates: false,
  }, async ({ c }) => {
    // Get the most recent baseline check
    const [lastCheck] = await getDb()
      .select()
      .from(idpBaselineChecks)
      .orderBy(desc(idpBaselineChecks.checkedAt))
      .limit(1)

    if (!lastCheck) {
      return c.json({
        lastCheck: null,
        message: 'No baseline checks performed yet',
      })
    }

    return c.json({
      lastCheck: {
        id: lastCheck.id,
        checkedAt: lastCheck.checkedAt,
        checkedBy: lastCheck.checkedBy,
        mfaAvailable: lastCheck.mfaAvailable,
        claimsFound: lastCheck.claimsFound,
        error: lastCheck.error,
      },
    })
  }))

  /**
   * GET /auth/admin/idp-baseline/history
   * 
   * View all baseline check history (last 50 checks).
   */
  app.get('/auth/admin/idp-baseline/history', guarded({
    gate: adminGate,
    mutates: false,
  }, async ({ c }) => {
    const checks = await getDb()
      .select()
      .from(idpBaselineChecks)
      .orderBy(desc(idpBaselineChecks.checkedAt))
      .limit(50)

    return c.json({
      checks: checks.map(check => ({
        id: check.id,
        checkedAt: check.checkedAt,
        checkedBy: check.checkedBy,
        mfaAvailable: check.mfaAvailable,
        claimsFound: check.claimsFound,
        error: check.error,
      })),
    })
  }))
}
