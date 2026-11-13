import { getDb } from '../../db/database.js'
import { accessReviewReports } from '../../db/schema.js'
import { emitNotification } from '../../notifications.js'
import { listInstanceAdmins } from '../../authzInstanceStore.js'

export const UNSIGNED_ACCESS_REVIEW_MS = 14 * 24 * 60 * 60 * 1000
const dayMs = 24 * 60 * 60 * 1000

export type OverdueAccessReview = { quarter: string; reportId: string }

export type AccessReviewAlertCandidate = {
  quarter: string
  reportId: string
  generatedAt: number
  signed: boolean
}

export type UnsignedAccessReviewDecision =
  | { alert: false }
  | {
      alert: true
      quarter: string
      reportId: string
      summary: string
    }

/**
 * Decides whether one stored report should alert security admins (Ticket 41).
 * Owns the 14-day unsigned threshold and alert copy.
 */
export function decideUnsignedAccessReviewAlert(
  report: AccessReviewAlertCandidate,
  now: number,
): UnsignedAccessReviewDecision {
  if (report.signed) return { alert: false }
  if (report.generatedAt > now - UNSIGNED_ACCESS_REVIEW_MS) return { alert: false }
  return {
    alert: true,
    quarter: report.quarter,
    reportId: report.reportId,
    summary: `${report.quarter} (${report.reportId}) has been unsigned for 14 days.`,
  }
}

/** Map a stored report row into the alert decision candidate shape. */
export function accessReviewAlertCandidateFromRow(row: {
  quarter: string
  report: { reportId: string; generatedAt: number; reviewerSignature?: unknown }
}): AccessReviewAlertCandidate {
  return {
    quarter: row.quarter,
    reportId: row.report.reportId,
    generatedAt: row.report.generatedAt,
    signed: !!row.report.reviewerSignature,
  }
}

/** Pure filter: overdue unsigned reports from in-memory candidates. */
export function overdueAccessReviews(
  reports: AccessReviewAlertCandidate[],
  now: number,
): OverdueAccessReview[] {
  return reports
    .map((report) => decideUnsignedAccessReviewAlert(report, now))
    .filter((d): d is Extract<UnsignedAccessReviewDecision, { alert: true }> => d.alert)
    .map((d) => ({ quarter: d.quarter, reportId: d.reportId }))
}

/** Unsigned quarterly reports whose generation is at least 14 days ago. */
export async function listOverdueAccessReviews(now = Date.now()): Promise<OverdueAccessReview[]> {
  const rows = await getDb().select().from(accessReviewReports)
  return overdueAccessReviews(rows.map(accessReviewAlertCandidateFromRow), now)
}

/** Tells each instance admin, once per day, that a quarterly access review is still unsigned. */
export function startAccessReviewAlertSchedule(opts: { now?: () => number; poll?: boolean } = {}) {
  const now = opts.now ?? (() => Date.now())
  const tick = async () => {
    const at = now()
    const rows = await getDb().select().from(accessReviewReports)
    const decisions = rows
      .map((row) => decideUnsignedAccessReviewAlert(accessReviewAlertCandidateFromRow(row), at))
      .filter((d): d is Extract<UnsignedAccessReviewDecision, { alert: true }> => d.alert)
    if (decisions.length === 0) return false
    const admins = await listInstanceAdmins()
    const day = new Date(at).toISOString().slice(0, 10)
    for (const decision of decisions) {
      await emitNotification({
        id: `access-review-unsigned:${decision.reportId}:${day}`,
        category: 'security',
        title: 'Access review unsigned',
        summary: decision.summary,
        href: '/settings#access-review',
        audience: 'personal',
        recipients: admins.map((admin) => ({ iss: admin.iss, sub: admin.sub })),
        createdAt: new Date(at).toISOString(),
      })
    }
    return true
  }
  const safe = () => {
    void tick().catch((err) => console.error('[mice-auth] unsigned access review alert failed', err))
  }
  const timer = opts.poll === false ? undefined : setInterval(safe, dayMs)
  timer?.unref()
  if (opts.poll !== false) safe()
  return { tick, stop: () => clearInterval(timer) }
}
