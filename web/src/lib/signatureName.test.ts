import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideNameHistoryRowDisplay,
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

  it('adds a now-known-as note when the current name differs', () => {
    assert.deepEqual(
      decideSignatureNameDisplay(
        { name: 'Dr. Jane Smith', signedAt: Date.UTC(2021, 2, 15) },
        'Dr. Jane Jones',
      ),
      {
        signedLine: 'Signed by: Dr. Jane Smith (2021-03-15)',
        nowKnownAs: 'Dr. Jane Jones',
      },
    )
  })

  it('omits the now-known-as note when the current name matches the signed name', () => {
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
      'Signed by: Dr. Jane Smith (2021-03-15) (now known as: Dr. Jane Jones)',
    )
  })

  it('labels history bounds as a calendar day or current', () => {
    assert.equal(nameHistoryDayLabel('2021-03-15T12:00:00.000Z'), '2021-03-15')
    assert.equal(nameHistoryDayLabel(null), 'current')
  })

  it('formats one name-history row for the admin timeline', () => {
    assert.deepEqual(
      decideNameHistoryRowDisplay({
        name: 'Dr. Jane Smith',
        validFrom: '2021-03-15T12:00:00.000Z',
        validTo: '2023-01-01T00:00:00.000Z',
      }),
      { name: 'Dr. Jane Smith', fromDay: '2021-03-15', toDay: '2023-01-01', isCurrent: false },
    )
    assert.deepEqual(
      decideNameHistoryRowDisplay({
        name: 'Dr. Jane Jones',
        validFrom: '2023-01-01T00:00:00.000Z',
        validTo: null,
      }),
      { name: 'Dr. Jane Jones', fromDay: '2023-01-01', toDay: 'current', isCurrent: true },
    )
  })
})
