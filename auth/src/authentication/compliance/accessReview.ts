import type { PrincipalId } from '../session/principal.js'
import type { SignatureRecord } from '../signing/signingCeremony.js'

/**
 * TICKET 12: Quarterly Access Review and Two-Person Recovery
 * 
 * Provides compliance reporting and emergency recovery procedures.
 */

export interface PrincipalAccessRecord {
  principal: PrincipalId & { name: string }
  roles: string[]
  grants: string[]
  lastLogin?: number
}

export interface AccessReviewReport {
  reportId: string
  quarter: string
  generatedAt: number
  principals: PrincipalAccessRecord[]
  reviewerSignature?: SignatureRecord
}

export interface RecoveryToken {
  tokenId: string
  issuedBy: [PrincipalId & { name: string }, PrincipalId & { name: string }]
  issuedAt: number
  expiresAt: number
  purpose: string
}

/**
 * Generate a quarterly access review report.
 */
export function generateAccessReviewReport(
  principals: PrincipalAccessRecord[],
  quarter: string,
): AccessReviewReport {
  return {
    reportId: `access-review-${quarter}-${Date.now()}`,
    quarter,
    generatedAt: Date.now(),
    principals,
  }
}

/**
 * Sign an access review report.
 */
export function signAccessReviewReport(
  report: AccessReviewReport,
  signature: SignatureRecord,
): AccessReviewReport {
  return {
    ...report,
    reviewerSignature: signature,
  }
}

/**
 * Validate that a reviewer has signed the report.
 */
export function validateReportSignature(report: AccessReviewReport): void {
  if (!report.reviewerSignature) {
    throw new Error('Access review report must be signed by named reviewer')
  }
}

/**
 * Create a two-person recovery token.
 * Requires approval from two different admins.
 */
export function createRecoveryToken(
  admin1: PrincipalId & { name: string },
  admin2: PrincipalId & { name: string },
  purpose: string,
  durationMs: number = 3600000, // 1 hour default
): RecoveryToken {
  if (admin1.iss === admin2.iss && admin1.sub === admin2.sub) {
    throw new Error('Recovery token requires two different admins')
  }
  
  const now = Date.now()
  return {
    tokenId: `recovery-${now}`,
    issuedBy: [admin1, admin2],
    issuedAt: now,
    expiresAt: now + durationMs,
    purpose,
  }
}

/**
 * Validate that recovery token was issued by two admins.
 */
export function validateRecoveryToken(token: RecoveryToken): void {
  if (token.issuedBy.length !== 2) {
    throw new Error('Recovery token must be issued by exactly two admins')
  }
  
  const [admin1, admin2] = token.issuedBy
  if (admin1.iss === admin2.iss && admin1.sub === admin2.sub) {
    throw new Error('Recovery token requires two different admins')
  }
}

/**
 * Check if recovery token is still valid (not expired).
 */
export function isRecoveryTokenValid(token: RecoveryToken, now: number = Date.now()): boolean {
  return now < token.expiresAt
}
