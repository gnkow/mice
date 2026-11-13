import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideSignatureNameDisplay,
  nameHistoryDayLabel,
  shownSignature,
} from './signatureName.js'

describe('signature name display', () => {
  it('shows the name captured at signing and the date', () => {
    assert.deepEqual(
      decideSignatureNameDisplay({ name: 'Dr. Jane Smith', signedAt: Date.UTC(2021, 2, 15) }),
      { signedLine: 'Signed by: Dr. Jane Smith (2021-03-15)' },
    )
  })

  it('adds a currently note when the current name differs', () => {
    assert.deepEqual(
      decideSignatureNameDisplay(
        { name: 'Dr. Jane Smith', signedAt: Date.UTC(2021, 2, 15) },
        'Dr. Jane Jones',
      ),
      {
        signedLine: 'Signed by: Dr. Jane Smith (2021-03-15)',
        currently: 'Dr. Jane Jones',
      },
    )
  })

  it('omits the currently note when the current name matches the signed name', () => {
    assert.deepEqual(
      decideSignatureNameDisplay(
        { name: 'Dr. Jane Smith', signedAt: Date.UTC(2021, 2, 15) },
        'Dr. Jane Smith',
      ),
      { signedLine: 'Signed by: Dr. Jane Smith (2021-03-15)' },
    )
  })

  it('composes the access-review string from the display decision', () => {
    assert.equal(
      shownSignature({ name: 'Dr. Jane Smith', signedAt: Date.UTC(2021, 2, 15) }, 'Dr. Jane Jones'),
      'Signed by: Dr. Jane Smith (2021-03-15) (currently: Dr. Jane Jones)',
    )
  })

  it('labels history bounds as a calendar day or current', () => {
    assert.equal(nameHistoryDayLabel('2021-03-15T12:00:00.000Z'), '2021-03-15')
    assert.equal(nameHistoryDayLabel(null), 'current')
  })
})
