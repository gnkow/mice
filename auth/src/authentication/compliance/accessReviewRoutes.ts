import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import {
  displayedAccessReview,
  getStoredAccessReview,
  openOrGenerateAccessReview,
  saveSignedAccessReview,
} from './accessReview.js'
import { applyAccessReviewSign } from './accessReviewSign.js'
import { listOverdueAccessReviews } from './accessReviewAlert.js'
import { reauthenticate } from '../oidc/stepUp.js'
import { createSignature, prepareForSigning, type SessionInfo } from '../signing/signingCeremony.js'
import { extractMfaEvidence } from '../signing/mfaEvidence.js'
import { decodeJwtPayload } from '../oidc/oidcClaims.js'
import { extractVerificationMetadata } from '../oidc/tokenVerificationMetadata.js'
import { isSigningBlockedByDrift } from './idpDriftDetection.js'
import { confirmPrivilegedGroups } from '../../authz.js'
import { env } from '../../env.js'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
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
    const result = await openOrGenerateAccessReview(quarter)

    if (result.outcome === 'read') {
      await audit({
        action: 'access-review.read',
        message: `Opened access review report for ${quarter}`,
        detail: { reportId: result.report.reportId, quarter },
      })
      return c.json({ report: result.report })
    }

    await audit({
      action: 'access-review.generate',
      message: `Generated access review report for ${quarter}`,
      detail: { reportId: result.report.reportId, principalCount: result.report.principals.length },
    })

    return c.json({
      report: result.report,
      contentHash: prepareForSigning(displayedAccessReview(result.report)).hash,
    })
  }))

  app.get('/auth/admin/access-review/overdue', guarded({
    gate: adminGate,
  }, async ({ c }) => {
    return c.json({ overdue: await listOverdueAccessReviews() })
  }))

  app.get('/auth/admin/access-review/:quarter', guarded({
    gate: adminGate,
  }, async ({ c, audit }) => {
    const quarter = c.req.param('quarter')
    const report = await getStoredAccessReview(quarter)
    if (!report) return c.json({ error: 'Access review report not found' }, 404)
    await audit({
      action: 'access-review.read',
      message: `Opened access review report for ${quarter}`,
      detail: { reportId: report.reportId, quarter },
    })
    return c.json({
      report,
      contentHash: prepareForSigning(displayedAccessReview(report)).hash,
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
    const stored = await getStoredAccessReview(quarter)
    if (!stored) return c.json({ error: 'Access review report not found' }, 404)

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
    const sealed = applyAccessReviewSign(stored, expectedHash, (content) =>
      createSignature(content, 'Reviewed', session),
    )
    if (!sealed.ok) return c.json({ error: sealed.error }, 400)
    await saveSignedAccessReview(quarter, sealed.report)
    await audit({
      action: 'access-review.sign',
      message: `Signed access review ${sealed.report.reportId}`,
      detail: { reportId: sealed.report.reportId, reviewer: `${user.iss}|${user.sub}` },
    })
    return c.json({ report: sealed.report, contentHash: sealed.contentHash })
  }))
}
