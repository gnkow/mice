import { getDb } from '../../db/database.js'
import { deviceApprovals } from '../../db/schema.js'
import { eq, gte, and } from 'drizzle-orm'
import { principalKey } from '../session/principal.js'
import type { SessionUser } from '../session/session.js'

/**
 * Device Approval Rate Limiting (Ticket 25, U15)
 * 
 * Prevents device flow phishing attacks by limiting approvals to 5 per 10 minutes
 * per Principal. An attacker spamming "your IT needs you to verify code BCDF-WXYZ"
 * emails will trigger rate limiting and security alerts.
 * 
 * Related:
 * - .scratch/authentication/issues/25-device-flow-phishing-mitigation.md
 * - Round 8 decision U15
 */

const APPROVAL_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const APPROVAL_LIMIT = 5

export type ApprovalRateLimitResult =
  | { allowed: true; count: number }
  | { allowed: false; count: number; windowMinutes: number }

/**
 * Check if Principal can approve another device (within rate limit).
 * Returns { allowed: true/false, count: current count in window }.
 */
export async function checkDeviceApprovalRateLimit(
  user: SessionUser
): Promise<ApprovalRateLimitResult> {
  const key = principalKey(user)
  const windowStart = new Date(Date.now() - APPROVAL_WINDOW_MS)
  
  // Count approvals in the last 10 minutes
  const recentApprovals = await getDb()
    .select()
    .from(deviceApprovals)
    .where(
      and(
        eq(deviceApprovals.principalKey, key),
        gte(deviceApprovals.approvedAt, windowStart)
      )
    )
  
  const count = recentApprovals.length
  
  if (count >= APPROVAL_LIMIT) {
    return {
      allowed: false,
      count,
      windowMinutes: APPROVAL_WINDOW_MS / 60000,
    }
  }
  
  return { allowed: true, count }
}

/**
 * Record a device approval for rate limiting tracking.
 * Also returns whether this approval triggers a security alert (5th approval in window).
 */
export async function recordDeviceApproval(
  user: SessionUser,
  userCode: string,
  approverHashedIp?: string | null
): Promise<{ shouldAlert: boolean; count: number }> {
  const key = principalKey(user)
  
  await getDb().insert(deviceApprovals).values({
    principalKey: key,
    userCode,
    approverHashedIp: approverHashedIp ?? null,
    approvedAt: new Date(),
  })
  
  // Check if this is the 5th approval (trigger alert)
  const windowStart = new Date(Date.now() - APPROVAL_WINDOW_MS)
  const recentCount = await getDb()
    .select()
    .from(deviceApprovals)
    .where(
      and(
        eq(deviceApprovals.principalKey, key),
        gte(deviceApprovals.approvedAt, windowStart)
      )
    )
  
  const count = recentCount.length
  const shouldAlert = count >= APPROVAL_LIMIT
  
  return { shouldAlert, count }
}

/**
 * Get recent approval timestamps for security alerts.
 * Returns the last N approvals within the window.
 */
export async function getRecentApprovals(
  user: SessionUser,
  limit: number = 10
): Promise<Array<{ userCode: string; approvedAt: Date }>> {
  const key = principalKey(user)
  const windowStart = new Date(Date.now() - APPROVAL_WINDOW_MS)
  
  const approvals = await getDb()
    .select({
      userCode: deviceApprovals.userCode,
      approvedAt: deviceApprovals.approvedAt,
    })
    .from(deviceApprovals)
    .where(
      and(
        eq(deviceApprovals.principalKey, key),
        gte(deviceApprovals.approvedAt, windowStart)
      )
    )
    .orderBy(deviceApprovals.approvedAt)
    .limit(limit)
  
  return approvals.map(a => ({
    userCode: a.userCode,
    approvedAt: a.approvedAt,
  }))
}
