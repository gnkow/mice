import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildTestIdTokenClaims } from './testIdTokenClaims.js'

describe('buildTestIdTokenClaims', () => {
  const base = { sub: 'ann', email: 'ann@mice.local' }

  it('marks MFA vs non-MFA in amr and acr', () => {
    assert.deepEqual(buildTestIdTokenClaims({ ...base, mfa: false }, { nowSec: 1_000 }).amr, ['pwd'])
    assert.equal(buildTestIdTokenClaims({ ...base, mfa: false }, { nowSec: 1_000 }).acr, 'pwd')
    assert.deepEqual(buildTestIdTokenClaims({ ...base, mfa: true }, { nowSec: 1_000 }).amr, ['pwd', 'otp'])
    assert.equal(buildTestIdTokenClaims({ ...base, mfa: true }, { nowSec: 1_000 }).acr, 'mfa')
  })

  it('omits name when configured null and marks guests', () => {
    const nameless = buildTestIdTokenClaims({ ...base, name: null }, { nowSec: 1_000 })
    assert.equal('name' in nameless, false)
    const guest = buildTestIdTokenClaims({ ...base, name: 'G', guest: true }, { nowSec: 1_000 })
    assert.equal(guest.guest, true)
  })

  it('stamps auth_time from IdP-now minus age', () => {
    const claims = buildTestIdTokenClaims(base, { nowSec: 5_000, authAgeSec: 120 })
    assert.equal(claims.auth_time, 4_880)
  })
})
