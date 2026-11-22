import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUDITOR_GRANT_CONSTRAINTS,
  AUDITOR_GRANT_HINT,
  AUDITOR_MFA_BANNER,
  decideAuditorMfaBanner,
  isAuditorRole,
} from './auditorGrant'

describe('auditorGrant', () => {
  it('names the four operator constraints and recognises the Auditor role', () => {
    assert.deepEqual(
      AUDITOR_GRANT_CONSTRAINTS.map((c) => c.id),
      ['expiry', 'mfa', 'acl-read', 'no-mutate'],
    )
    assert.ok(AUDITOR_GRANT_HINT.length > 0)
    assert.equal(isAuditorRole('auditor'), true)
    assert.equal(isAuditorRole('user'), false)
    assert.equal(isAuditorRole(null), false)
  })

  it('shows the MFA banner only for Auditor without evidence', () => {
    assert.equal(
      decideAuditorMfaBanner({ role: 'auditor', mfaEvidenced: false }),
      AUDITOR_MFA_BANNER,
    )
    assert.equal(decideAuditorMfaBanner({ role: 'auditor', mfaEvidenced: undefined }), AUDITOR_MFA_BANNER)
    assert.equal(decideAuditorMfaBanner({ role: 'auditor', mfaEvidenced: true }), null)
    assert.equal(decideAuditorMfaBanner({ role: 'user', mfaEvidenced: false }), null)
  })
})
