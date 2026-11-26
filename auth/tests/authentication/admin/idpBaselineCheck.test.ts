import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  idpBaselineCheckAdminView,
  latestIdpBaselineCheck,
  listIdpBaselineChecks,
  recordIdpBaselineCheck,
} from '../../../src/packages/authentication/lib/admin/idpBaselineCheck.js'

/**
 * Ticket 14 deepen: decode → evaluate → store behind one seam;
 * status/history share the same admin view.
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

describe('idpBaselineCheckAdminView', () => {
  it('projects a stored row into the admin JSON shape', () => {
    const checkedAt = new Date('2026-06-01T12:00:00.000Z')
    assert.deepEqual(
      idpBaselineCheckAdminView({
        id: 9,
        checkedAt,
        checkedBy: 'https://idp.test|admin',
        mfaAvailable: true,
        claimsFound: { acr: 'mfa', amr: ['pwd', 'otp'] },
        error: null,
      }),
      {
        id: 9,
        checkedAt,
        checkedBy: 'https://idp.test|admin',
        mfaAvailable: true,
        claimsFound: { acr: 'mfa', amr: ['pwd', 'otp'] },
        error: null,
      },
    )
  })
})

describe('latestIdpBaselineCheck / listIdpBaselineChecks', () => {
  it('returns null when no checks exist', async () => {
    const latest = await latestIdpBaselineCheck({
      findLatest: async () => null,
    })
    assert.equal(latest, null)
  })

  it('returns the latest row through the admin view', async () => {
    const checkedAt = new Date('2026-06-02T00:00:00.000Z')
    const latest = await latestIdpBaselineCheck({
      findLatest: async () => ({
        id: 3,
        checkedAt,
        checkedBy: 'iss|sub',
        mfaAvailable: false,
        claimsFound: { amr: [] },
        error: 'IdP token does not present MFA evidence (acr/amr)',
      }),
    })
    assert.deepEqual(latest, {
      id: 3,
      checkedAt,
      checkedBy: 'iss|sub',
      mfaAvailable: false,
      claimsFound: { amr: [] },
      error: 'IdP token does not present MFA evidence (acr/amr)',
    })
  })

  it('lists recent checks newest-first through the admin view', async () => {
    const a = new Date('2026-06-03T00:00:00.000Z')
    const b = new Date('2026-06-02T00:00:00.000Z')
    const list = await listIdpBaselineChecks(2, {
      findRecent: async (limit) => {
        assert.equal(limit, 2)
        return [
          {
            id: 2,
            checkedAt: a,
            checkedBy: 'iss|a',
            mfaAvailable: true,
            claimsFound: { amr: ['otp'] },
            error: null,
          },
          {
            id: 1,
            checkedAt: b,
            checkedBy: 'iss|b',
            mfaAvailable: false,
            claimsFound: null,
            error: 'No id_token claims available for baseline check',
          },
        ]
      },
    })
    assert.equal(list.length, 2)
    assert.equal(list[0].id, 2)
    assert.equal(list[1].checkedBy, 'iss|b')
  })
})
