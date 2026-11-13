import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SEAL_KEY_ROTATION_DAYS, decideSealKeyScheduleStatus } from './sealKeySchedule.js'

describe('decideSealKeyScheduleStatus', () => {
  const day = 24 * 60 * 60
  const issued = 1_700_000_000

  it('reports next eligible 30 days after issue when not due', () => {
    const now = issued + 10 * day
    const status = decideSealKeyScheduleStatus(issued, now)
    assert.equal(status.lastScheduledFrom, issued)
    assert.equal(status.nextEligibleAt, issued + SEAL_KEY_ROTATION_DAYS * day)
    assert.equal(status.due, false)
    assert.match(status.summary, /30-day schedule/)
    assert.match(status.summary, /Next eligible/)
  })

  it('marks due when key age reaches 30 days', () => {
    const now = issued + SEAL_KEY_ROTATION_DAYS * day
    const status = decideSealKeyScheduleStatus(issued, now)
    assert.equal(status.due, true)
    assert.match(status.summary, /due/)
  })
})
