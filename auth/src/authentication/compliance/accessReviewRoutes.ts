import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import { getDb } from '../../db/database.js'
import { accessReviewReports, principals } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { displayedAccessReview, generateAccessReviewReport, signAccessReviewReport } from './accessReview.js'
import { reauthenticate } from '../oidc/stepUp.js'
import { createSignature, prepareForSigning, type SessionInfo } from '../signing/signingCeremony.js'
import { extractMfaEvidence } from '../signing/mfaEvidence.js'
import { decodeJwtPayload } from '../oidc/oidcClaims.js'
import { extractVerificationMetadata } from '../oidc/tokenVerificationMetadata.js'
import { isSigningBlockedByDrift } from './idpDriftDetection.js'
import { confirmPrivilegedGroups } from '../../authz.js'
import { env } from '../../env.js'
import { instancePermissions, isInstanceAdmin } from '../../authzInstanceStore.js'
import { namespaceRolesFor } from '../../authzMembershipStore.js'
import type { AuditDep } from '../../routeDeps.js'
import type { SessionUser } from '../session/session.js'

/**
 * Admin endpoints for quarterly access review reports.
 */

const adminGate = async (u: SessionUser) => (await isInstanceAdmin(u) ? null : 'Admin required')

export function registerAccessReviewRoutes(app: Hono, { audit }: AuditDep): void {
  // Generate quarterly access review report
  app.post('/auth/admin/access-review/generate', guarded({
    gate: adminGate,
    mutates: true,
    body: { required: ['quarter'] },
  }, async ({ c, body, audit }) => {
    const quarter = body.quarter as string
    const [stored] = await getDb()
      .select()
      .from(accessReviewReports)
      .where(eq(accessReviewReports.quarter, quarter))
      .limit(1)
    if (stored) {
      await audit({
        action: 'access-review.read',
        message: `Opened access review report for ${quarter}`,
        detail: { reportId: stored.report.reportId, quarter },
      })
      return c.json({ report: stored.report })
    }

    // Fetch all principals from database
    const allPrincipals = await getDb()
      .select()
      .from(principals)
    
    // Build report data for each principal
    const principalRecords = await Promise.all(
      allPrincipals.map(async (p) => {
        const principal = { iss: p.iss, sub: p.sub, name: p.name || 'Unknown' }
        
        // Get instance permissions
        const perms = await instancePermissions(principal)
        
        // Get namespace roles
        const roles = await namespaceRolesFor(principal)
        const rolesList = Array.from(roles.entries()).map(([ns, role]) => `${ns}:${role}`)
        
        return {
          principal,
          roles: rolesList,
          grants: perms,
          ...(p.lastLoginAt ? { lastLogin: p.lastLoginAt.getTime() } : {}),
        }
      })
    )
    
    const report = generateAccessReviewReport(principalRecords, quarter)
    await getDb().insert(accessReviewReports).values({
      quarter,
      report,
      createdAt: new Date(report.generatedAt),
    })

    await audit({
      action: 'access-review.generate',
      message: `Generated access review report for ${quarter}`,
      detail: { reportId: report.reportId, principalCount: principalRecords.length },
    })

    return c.json({ report, contentHash: prepareForSigning(displayedAccessReview(report)).hash })
  }))

  app.get('/auth/admin/access-review/:quarter', guarded({
    gate: adminGate,
  }, async ({ c, audit }) => {
    const quarter = c.req.param('quarter')
    const [stored] = await getDb()
      .select()
      .from(accessReviewReports)
      .where(eq(accessReviewReports.quarter, quarter))
      .limit(1)
    if (!stored) return c.json({ error: 'Access review report not found' }, 404)
    await audit({
      action: 'access-review.read',
      message: `Opened access review report for ${quarter}`,
      detail: { reportId: stored.report.reportId, quarter },
    })
    return c.json({
      report: stored.report,
      contentHash: prepareForSigning(displayedAccessReview(stored.report)).hash,
    })
  }))

  app.post('/auth/admin/access-review/sign', guarded({
    gate: adminGate,
    mutates: true,
    body: { required: ['quarter', 'expectedHash'] },
  }, async ({ c, user, body, audit }) => {
    try {
      await confirmPrivilegedGroups(user)
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
        return c.json({ error: 'Directory unavailable' }, 503)
      }
      throw err
    }
    const drift = await isSigningBlockedByDrift()
    if (drift.blocked) return c.json({ error: 'Signing blocked due to critical IdP configuration drift' }, 503)
    const stepUp = await reauthenticate(c, 60)
    if (!stepUp.ok) return stepUp.response
    const now = Math.floor(Date.now() / 1000)
    if (env.sessionIdleSec > 0 && user.lastActive !== undefined && now - user.lastActive > env.sessionIdleSec) {
      return c.json({ error: 'session_idle' }, 401)
    }

    const quarter = body.quarter as string
    const expectedHash = body.expectedHash as string
    const [stored] = await getDb()
      .select()
      .from(accessReviewReports)
      .where(eq(accessReviewReports.quarter, quarter))
      .limit(1)
    if (!stored) return c.json({ error: 'Access review report not found' }, 404)

    const content = displayedAccessReview(stored.report)
    const prepared = prepareForSigning(content)
    if (prepared.hash !== expectedHash) {
      return c.json({ error: 'Content changed after display; signature invalidated' }, 400)
    }

    let mfaVerified = false
    let mfaEvidenceData: SessionInfo['mfaEvidence']
    let verificationMetadataData: SessionInfo['verificationMetadata']
    if (stepUp.user.idToken) {
      try {
        const payload = decodeJwtPayload(stepUp.user.idToken)
        const mfaEvidence = extractMfaEvidence(payload)
        mfaVerified = mfaEvidence.hasMfa
        if (mfaEvidence.hasMfa) {
          mfaEvidenceData = { acr: mfaEvidence.acr, amr: mfaEvidence.amr, auth_time: stepUp.user.authTime }
        }
        verificationMetadataData = extractVerificationMetadata(stepUp.user.idToken)
      } catch {
        mfaVerified = false
      }
    }
    if (!mfaVerified) return c.json({ error: 'MFA required for electronic signature' }, 403)

    const session: SessionInfo = {
      authenticatedAt: (stepUp.user.authTime ?? 0) * 1000,
      mfaVerified,
      principal: { iss: user.iss, sub: user.sub, name: user.name },
      ...(mfaEvidenceData ? { mfaEvidence: mfaEvidenceData } : {}),
      ...(verificationMetadataData ? { verificationMetadata: verificationMetadataData } : {}),
    }
    const signature = createSignature(content, 'Reviewed', session)
    const signed = signAccessReviewReport(stored.report, signature)
    await getDb()
      .update(accessReviewReports)
      .set({ report: signed })
      .where(eq(accessReviewReports.quarter, quarter))
    await audit({
      action: 'access-review.sign',
      message: `Signed access review ${signed.reportId}`,
      detail: { reportId: signed.reportId, reviewer: `${user.iss}|${user.sub}` },
    })
    return c.json({ report: signed, contentHash: prepared.hash })
  }))
}
