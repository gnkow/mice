import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { recordIdpBaselineCheck } from './idpBaselineCheck.js'

/**
 * Ticket 14 deepen: decode → evaluate → store behind one seam.
 */

describe('recordIdpBaselineCheck', () => {
  it('stores MFA-available when the id_token claims qualify', async () => {
    const stored: Array<Record<string, unknown>> = []
    const result = await recordIdpBaselineCheck(
      {
        idToken: 'unused',
        checkedBy: 'https://idp.test|admin',
      },
      {
        decodeClaims: () => ({
          acr: 'mfa',
          amr: ['pwd', 'otp'],
          auth_time: 1_700_000_000,
        }),
        store: async (row) => {
          stored.push(row)
          return {
            id: 7,
            checkedAt: new Date('2026-01-01T00:00:00.000Z'),
            checkedBy: row.checkedBy,
            mfaAvailable: row.mfaAvailable,
            claimsFound: row.claimsFound,
            error: row.error,
          }
        },
      },
    )
    assert.equal(result.mfaAvailable, true)
    assert.equal(result.error, null)
    assert.equal(result.id, 7)
    assert.deepEqual(result.claimsFound, {
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      authTime: 1_700_000_000,
    })
    assert.equal(stored.length, 1)
    assert.equal(stored[0].checkedBy, 'https://idp.test|admin')
  })

  it('stores decode failure without calling evaluate on a bad token', async () => {
    const result = await recordIdpBaselineCheck(
      { idToken: 'bad', checkedBy: 'iss|sub' },
      {
        decodeClaims: () => {
          throw new Error('Malformed id_token')
        },
        store: async (row) => ({
          id: 1,
          checkedAt: new Date(0),
          checkedBy: row.checkedBy,
          mfaAvailable: row.mfaAvailable,
          claimsFound: row.claimsFound,
          error: row.error,
        }),
      },
    )
    assert.equal(result.mfaAvailable, false)
    assert.equal(result.claimsFound, null)
    assert.match(result.error ?? '', /Malformed id_token/)
  })

  it('stores missing-claims evaluation when no id_token is present', async () => {
    const result = await recordIdpBaselineCheck(
      { checkedBy: 'iss|sub' },
      {
        store: async (row) => ({
          id: 2,
          checkedAt: new Date(0),
          checkedBy: row.checkedBy,
          mfaAvailable: row.mfaAvailable,
          claimsFound: row.claimsFound,
          error: row.error,
        }),
      },
    )
    assert.equal(result.mfaAvailable, false)
    assert.equal(result.claimsFound, null)
    assert.match(result.error ?? '', /id_token|claims/i)
  })
})
