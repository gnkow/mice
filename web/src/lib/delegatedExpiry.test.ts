import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { delegatedExpiryLabel, delegatedExpiryTone } from './delegatedExpiry'

describe('delegatedExpiryTone (#14)', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z')

  it('marks past expiry as expired', () => {
    assert.equal(delegatedExpiryTone(now - 1, now), 'expired')
    assert.equal(delegatedExpiryLabel(now - 1, now), 'Expired')
  })

  it('marks within 7 days as soon', () => {
    assert.equal(delegatedExpiryTone(now + 2 * 24 * 60 * 60 * 1000, now), 'soon')
    assert.match(delegatedExpiryLabel(now + 2 * 24 * 60 * 60 * 1000, now), /Expires in 2 days/)
  })

  it('marks later dates as ok', () => {
    assert.equal(delegatedExpiryTone(now + 30 * 24 * 60 * 60 * 1000, now), 'ok')
  })
})
