import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSignatureView, decideNowKnownAs } from './signatureIdentityDisplay.js'

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

  it('builds a view with the printed snapshot and optional nowKnownAs', () => {
    const snapshot = {
      id: 'sig-1',
      meaning: 'Approved' as const,
      signedAt: '2021-03-15T00:00:00.000Z',
      signer: { iss: 'https://idp.test', sub: 'u1', name: 'Dr. Jane Smith' },
    }
    assert.deepEqual(buildSignatureView(snapshot, 'Dr. Jane Smith'), snapshot)
    assert.deepEqual(buildSignatureView(snapshot, 'Dr. Jane Jones'), {
      ...snapshot,
      nowKnownAs: 'Dr. Jane Jones',
    })
    assert.deepEqual(buildSignatureView(snapshot, null), snapshot)
  })
})
