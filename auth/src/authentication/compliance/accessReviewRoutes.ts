import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import { getDb } from '../../db/database.js'
import { accessReviewReports, principals } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { generateAccessReviewReport, createRecoveryToken, isRecoveryTokenValid } from './accessReview.js'
import { instancePermissions, isInstanceAdmin } from '../../authzInstanceStore.js'
import { namespaceRolesFor } from '../../authzMembershipStore.js'
import type { AuditDep } from '../../routeDeps.js'
import type { SessionUser } from '../session/session.js'

/**
 * TICKET 12: Quarterly Access Review and Two-Person Recovery Routes
 * 
 * Admin endpoints for generating access review reports and recovery tokens.
 */

const adminGate = async (u: SessionUser) => (await isInstanceAdmin(u) ? null : 'Admin required')

// In-memory storage for pending recovery token approvals
// In production, this should be persisted (Redis, DB, etc.)
const pendingRecoveryTokens = new Map<string, {
  firstAdmin: { iss: string; sub: string; name: string }
  purpose: string
  requestedAt: number
}>()

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

    return c.json({ report })
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
    return c.json({ report: stored.report })
  }))

  // Request recovery token (first admin)
  app.post('/auth/admin/recovery-token/request', guarded({
    gate: adminGate,
    mutates: true,
    body: { required: ['purpose'] },
  }, async ({ c, user, body }) => {
    const purpose = body.purpose as string
    const requestId = `recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`
    
    pendingRecoveryTokens.set(requestId, {
      firstAdmin: { iss: user.iss, sub: user.sub, name: user.name },
      purpose,
      requestedAt: Date.now(),
    })
    
    // Clean up old requests (older than 1 hour)
    const oneHourAgo = Date.now() - 3600000
    for (const [id, req] of pendingRecoveryTokens.entries()) {
      if (req.requestedAt < oneHourAgo) {
        pendingRecoveryTokens.delete(id)
      }
    }
    
    await audit({
      action: 'recovery-token.request',
      message: `Admin ${user.name} requested recovery token`,
      detail: { requestId, purpose },
    })
    
    return c.json({ requestId, message: 'Recovery token request created. Requires second admin approval.' })
  }))

  // Approve recovery token (second admin)
  app.post('/auth/admin/recovery-token/approve', guarded({
    gate: adminGate,
    mutates: true,
    body: { required: ['requestId'] },
  }, async ({ c, user, body }) => {
    const requestId = body.requestId as string
    const pending = pendingRecoveryTokens.get(requestId)
    
    if (!pending) {
      return c.json({ error: 'Recovery token request not found or expired' }, 404)
    }
    
    // Ensure second admin is different from first
    if (pending.firstAdmin.iss === user.iss && pending.firstAdmin.sub === user.sub) {
      return c.json({ error: 'Recovery token requires approval from a different admin' }, 400)
    }
    
    // Create the token
    const token = createRecoveryToken(
      pending.firstAdmin,
      { iss: user.iss, sub: user.sub, name: user.name },
      pending.purpose
    )
    
    // Remove from pending
    pendingRecoveryTokens.delete(requestId)
    
    await audit({
      action: 'recovery-token.create',
      message: `Recovery token created by ${pending.firstAdmin.name} and ${user.name}`,
      detail: { tokenId: token.tokenId, purpose: token.purpose },
    })
    
    return c.json({ token })
  }))

  // Validate recovery token
  app.post('/auth/admin/recovery-token/validate', guarded({
    body: { required: ['tokenId'] },
  }, async ({ c, body }) => {
    const tokenId = body.tokenId as string
    
    // In production, retrieve token from storage
    // For now, this is a placeholder that shows the validation pattern
    
    return c.json({ 
      error: 'Token storage not yet implemented. Tokens must be persisted to validate them.' 
    }, 501)
  }))

  // List pending recovery token requests
  app.get('/auth/admin/recovery-token/pending', guarded({
    gate: adminGate,
  }, async ({ c, user }) => {
    const pending = Array.from(pendingRecoveryTokens.entries()).map(([id, req]) => ({
      requestId: id,
      firstAdmin: req.firstAdmin,
      purpose: req.purpose,
      requestedAt: req.requestedAt,
      canApprove: !(req.firstAdmin.iss === user.iss && req.firstAdmin.sub === user.sub),
    }))
    
    return c.json({ pending })
  }))
}
