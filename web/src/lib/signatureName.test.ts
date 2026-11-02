import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shownSignature } from './signatureName.js'

describe('signature name', () => {
  it('shows the name captured at signing and the date', () => {
    assert.equal(
      shownSignature({ name: 'Dr. Jane Smith', signedAt: Date.UTC(2021, 2, 15) }),
      'Signed by: Dr. Jane Smith (2021-03-15)',
    )
  })

  it('shows the current name when it differs from the name at signing', () => {
    assert.equal(
      shownSignature(
        { name: 'Dr. Jane Smith', signedAt: Date.UTC(2021, 2, 15) },
        'Dr. Jane Jones',
      ),
      'Signed by: Dr. Jane Smith (2021-03-15) (currently: Dr. Jane Jones)',
    )
  })

  it('omits the current name when it is the name at signing', () => {
    assert.equal(
      shownSignature(
        { name: 'Dr. Jane Smith', signedAt: Date.UTC(2021, 2, 15) },
        'Dr. Jane Smith',
      ),
      'Signed by: Dr. Jane Smith (2021-03-15)',
    )
  })
})
