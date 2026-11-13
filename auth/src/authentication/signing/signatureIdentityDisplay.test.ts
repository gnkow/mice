import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideNowKnownAs } from './signatureIdentityDisplay.js'

describe('signature identity display', () => {
  it('omits the note when the current name matches the signed snapshot', () => {
    assert.equal(decideNowKnownAs('Dr. Jane Smith', 'Dr. Jane Smith'), undefined)
    assert.equal(decideNowKnownAs('Dr. Jane Smith', undefined), undefined)
    assert.equal(decideNowKnownAs('Dr. Jane Smith', null), undefined)
    assert.equal(decideNowKnownAs('Dr. Jane Smith', ''), undefined)
  })

  it('returns the current name when it differs from the signed snapshot', () => {
    assert.equal(decideNowKnownAs('Dr. Jane Smith', 'Dr. Jane Jones'), 'Dr. Jane Jones')
  })
})
