import type { PrincipalId } from '../session/principal.js'
import type { SignatureRecord } from '../signing/signingCeremony.js'

/**
 * Quarterly access review report.
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

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/** The exact document a reviewer is shown. The signature hash is of this string. */
export function displayedAccessReview(report: AccessReviewReport): string {
  const displayed = { ...report }
  delete displayed.reviewerSignature
  return JSON.stringify(sorted(displayed))
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
