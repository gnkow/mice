import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUDITOR_CANNOT_SIGN,
  AUDITOR_MFA_REASON,
  decideAclBypassRead,
  decideAuditorAdmission,
  decideAuditorCannotSign,
  decideAuditorMfa,
} from '../../src/packages/audit/lib/auditorAccess.js'

describe('decideAuditorMfa', () => {
  it('refuses only Auditor without MFA', () => {
    assert.equal(decideAuditorMfa({ role: 'auditor', hasMfa: false }), AUDITOR_MFA_REASON)
    assert.equal(decideAuditorMfa({ role: 'auditor', hasMfa: true }), null)
    assert.equal(decideAuditorMfa({ role: 'user', hasMfa: false }), null)
    assert.equal(decideAuditorMfa({ role: null, hasMfa: false }), null)
  })
})

describe('decideAuditorAdmission', () => {
  it('honours the /auth/me exemption without weakening the MFA rule', () => {
    assert.equal(
      decideAuditorAdmission({ role: 'auditor', hasMfa: false, allowWithoutMfa: true }),
      null,
    )
    assert.equal(
      decideAuditorAdmission({ role: 'auditor', hasMfa: false, allowWithoutMfa: false }),
      AUDITOR_MFA_REASON,
    )
    assert.equal(decideAuditorAdmission({ role: 'auditor', hasMfa: false }), AUDITOR_MFA_REASON)
  })
})

describe('decideAclBypassRead', () => {
  it('allows MFA + bypass_acl read for sessions, never PATs or writes', () => {
    assert.deepEqual(
      decideAclBypassRead({ need: 'read', isPat: false, hasBypassAcl: true, hasMfa: true }),
      { allow: true, bypass: true },
    )
    assert.deepEqual(
      decideAclBypassRead({ need: 'read', isPat: true, hasBypassAcl: true, hasMfa: true }),
      { allow: false, bypass: false },
    )
    assert.deepEqual(
      decideAclBypassRead({ need: 'read', isPat: false, hasBypassAcl: true, hasMfa: false }),
      { allow: false, bypass: false },
    )
    assert.deepEqual(
      decideAclBypassRead({ need: 'write', isPat: false, hasBypassAcl: true, hasMfa: true }),
      { allow: false, bypass: false },
    )
    assert.deepEqual(
      decideAclBypassRead({ need: 'read', isPat: false, hasBypassAcl: false, hasMfa: true }),
      { allow: false, bypass: false },
    )
  })
})

describe('decideAuditorCannotSign', () => {
  it('refuses only the Auditor role', () => {
    assert.equal(decideAuditorCannotSign('auditor'), AUDITOR_CANNOT_SIGN)
    assert.equal(decideAuditorCannotSign('user'), null)
    assert.equal(decideAuditorCannotSign(null), null)
  })
})
