import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideUnsignedAccessReviewAlert,
  overdueAccessReviews,
  UNSIGNED_ACCESS_REVIEW_MS,
} from './accessReviewAlert.js'

const day = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 5, 15)

describe('accessReviewAlert decisions (#41)', () => {
  it('alerts when an unsigned report is older than 14 days', () => {
    const generatedAt = now - UNSIGNED_ACCESS_REVIEW_MS - day
    const decision = decideUnsignedAccessReviewAlert(
      { quarter: '2026-Q1', reportId: 'access-review-2026-Q1', generatedAt, signed: false },
      now,
    )
    assert.equal(decision.alert, true)
    if (!decision.alert) return
    assert.equal(decision.quarter, '2026-Q1')
    assert.equal(decision.reportId, 'access-review-2026-Q1')
    assert.match(decision.summary, /2026-Q1/)
    assert.match(decision.summary, /access-review-2026-Q1/)
    assert.match(decision.summary, /14 days/)
  })

  it('does not alert a signed report or a fresh unsigned report', () => {
    const old = now - UNSIGNED_ACCESS_REVIEW_MS - day
    assert.equal(
      decideUnsignedAccessReviewAlert(
        { quarter: '2026-Q1', reportId: 'r1', generatedAt: old, signed: true },
        now,
      ).alert,
      false,
    )
    assert.equal(
      decideUnsignedAccessReviewAlert(
        { quarter: '2026-Q2', reportId: 'r2', generatedAt: now - day, signed: false },
        now,
      ).alert,
      false,
    )
  })

  it('lists only overdue unsigned reports', () => {
    const overdue = overdueAccessReviews(
      [
        { quarter: '2020-Q1', reportId: 'old-unsigned', generatedAt: now - 20 * day, signed: false },
        { quarter: '2019-Q4', reportId: 'old-signed', generatedAt: now - 20 * day, signed: true },
        { quarter: '2026-Q2', reportId: 'fresh', generatedAt: now - day, signed: false },
      ],
      now,
    )
    assert.deepEqual(overdue, [{ quarter: '2020-Q1', reportId: 'old-unsigned' }])
  })
})
