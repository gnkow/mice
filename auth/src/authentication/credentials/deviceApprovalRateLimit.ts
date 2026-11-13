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
 */

const APPROVAL_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const APPROVAL_LIMIT = 5

export type ApprovalRateLimitResult =
  | { allowed: true; count: number }
  | { allowed: false; count: number; windowMinutes: number }

export type DeviceApprovalCommit = {
  shouldAlert: boolean
  count: number
  /** Non-null on the 5th approval in the window — ready to log. */
  securityWarning: string | null
}

export type DeviceApprovalBegin =
  | { allowed: false; count: number; windowMinutes: number }
  | {
      allowed: true
      count: number
      commit: (
        userCode: string,
        approverHashedIp?: string | null,
      ) => Promise<DeviceApprovalCommit>
    }

export type DeviceApprovalRateLimitDeps = {
  now?: () => number
  limit?: number
  windowMs?: number
}

export type DeviceApprovalRateLimit = {
  check(user: SessionUser): Promise<ApprovalRateLimitResult>
  record(
    user: SessionUser,
    userCode: string,
    approverHashedIp?: string | null,
  ): Promise<{ shouldAlert: boolean; count: number }>
  recent(
    user: SessionUser,
    limit?: number,
  ): Promise<Array<{ userCode: string; approvedAt: Date }>>
  /**
   * Small interface for the approve route: deny with 429 context, or return a
   * commit handle that records the approval and builds the security warning.
   */
  begin(user: SessionUser): Promise<DeviceApprovalBegin>
}

export function createDeviceApprovalRateLimit(
  deps: DeviceApprovalRateLimitDeps = {},
): DeviceApprovalRateLimit {
  const now = deps.now ?? Date.now
  const limit = deps.limit ?? APPROVAL_LIMIT
  const windowMs = deps.windowMs ?? APPROVAL_WINDOW_MS
  const windowMinutes = windowMs / 60_000

  async function approvalsInWindow(key: string) {
    const windowStart = new Date(now() - windowMs)
    return getDb()
      .select()
      .from(deviceApprovals)
      .where(
        and(
          eq(deviceApprovals.principalKey, key),
          gte(deviceApprovals.approvedAt, windowStart),
        ),
      )
  }

  async function check(user: SessionUser): Promise<ApprovalRateLimitResult> {
    const key = principalKey(user)
    const count = (await approvalsInWindow(key)).length
    if (count >= limit) {
      return { allowed: false, count, windowMinutes }
    }
    return { allowed: true, count }
  }

  async function record(
    user: SessionUser,
    userCode: string,
    approverHashedIp?: string | null,
  ): Promise<{ shouldAlert: boolean; count: number }> {
    const key = principalKey(user)
    await getDb().insert(deviceApprovals).values({
      principalKey: key,
      userCode,
      approverHashedIp: approverHashedIp ?? null,
      approvedAt: new Date(now()),
    })
    const count = (await approvalsInWindow(key)).length
    return { shouldAlert: count >= limit, count }
  }

  async function recent(
    user: SessionUser,
    recentLimit: number = 10,
  ): Promise<Array<{ userCode: string; approvedAt: Date }>> {
    const key = principalKey(user)
    const windowStart = new Date(now() - windowMs)
    const approvals = await getDb()
      .select({
        userCode: deviceApprovals.userCode,
        approvedAt: deviceApprovals.approvedAt,
      })
      .from(deviceApprovals)
      .where(
        and(
          eq(deviceApprovals.principalKey, key),
          gte(deviceApprovals.approvedAt, windowStart),
        ),
      )
      .orderBy(deviceApprovals.approvedAt)
      .limit(recentLimit)

    return approvals.map((a) => ({
      userCode: a.userCode,
      approvedAt: a.approvedAt,
    }))
  }

  async function begin(user: SessionUser): Promise<DeviceApprovalBegin> {
    const pre = await check(user)
    if (!pre.allowed) {
      return {
        allowed: false,
        count: pre.count,
        windowMinutes: pre.windowMinutes,
      }
    }
    return {
      allowed: true,
      count: pre.count,
      async commit(userCode, approverHashedIp) {
        const { shouldAlert, count } = await record(user, userCode, approverHashedIp)
        if (!shouldAlert) {
          return { shouldAlert, count, securityWarning: null }
        }
        const timestamps = (await recent(user, 10))
          .map((a) => a.approvedAt.toISOString())
          .join(', ')
        const securityWarning =
          `[SECURITY ALERT] Principal ${user.sub} (${user.email}) approved 5+ devices in 10 minutes. ` +
          `Recent approvals: ${timestamps}. Investigation recommended.`
        return { shouldAlert, count, securityWarning }
      },
    }
  }

  return { check, record, recent, begin }
}

const live = createDeviceApprovalRateLimit()

export const checkDeviceApprovalRateLimit = live.check
export const recordDeviceApproval = live.record
export const getRecentApprovals = live.recent
export const beginDeviceApproval = live.begin
