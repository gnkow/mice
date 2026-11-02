import { getDb } from '../../db/database.js'
import { accessReviewReports } from '../../db/schema.js'
import { emitNotification } from '../../notifications.js'
import { listInstanceAdmins } from '../../authzInstanceStore.js'

const unsignedForMs = 14 * 24 * 60 * 60 * 1000
const dayMs = 24 * 60 * 60 * 1000

export type OverdueAccessReview = { quarter: string; reportId: string }

/** Unsigned quarterly reports whose generation is at least 14 days ago. */
export async function listOverdueAccessReviews(now = Date.now()): Promise<OverdueAccessReview[]> {
  const cutoff = now - unsignedForMs
  const rows = await getDb().select().from(accessReviewReports)
  return rows
    .filter((row) => !row.report.reviewerSignature && row.report.generatedAt <= cutoff)
    .map((row) => ({ quarter: row.quarter, reportId: row.report.reportId }))
}

/** Tells each instance admin, once per day, that a quarterly access review is still unsigned. */
export function startAccessReviewAlertSchedule(opts: { now?: () => number; poll?: boolean } = {}) {
  const now = opts.now ?? (() => Date.now())
  const tick = async () => {
    const at = now()
    const overdue = await listOverdueAccessReviews(at)
    if (overdue.length === 0) return false
    const admins = await listInstanceAdmins()
    const day = new Date(at).toISOString().slice(0, 10)
    for (const report of overdue) {
      await emitNotification({
        id: `access-review-unsigned:${report.reportId}:${day}`,
        category: 'security',
        title: 'Access review unsigned',
        summary: `${report.quarter} (${report.reportId}) has been unsigned for 14 days.`,
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
