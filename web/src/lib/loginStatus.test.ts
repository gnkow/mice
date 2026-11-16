import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideLoginStatus,
  LOGIN_STATUS_CODES,
  loginStatusSearch,
} from './loginStatus'

describe('decideLoginStatus', () => {
  it('returns null for missing or unknown codes', () => {
    assert.equal(decideLoginStatus(null), null)
    assert.equal(decideLoginStatus(''), null)
    assert.equal(decideLoginStatus('nope'), null)
  })

  it('maps every refuse/outage code to a titled surface with a recovery hint', () => {
    for (const code of LOGIN_STATUS_CODES) {
      const surface = decideLoginStatus(code)
      assert.ok(surface)
      assert.equal(surface.code, code)
      assert.ok(surface.title.trim())
      assert.ok(surface.message.trim())
      assert.ok(surface.hint.trim())
    }
  })

  it('keeps BFF refuse copy and distinct titles for directory statuses', () => {
    assert.equal(decideLoginStatus('disabled')?.title, 'Account disabled')
    assert.equal(
      decideLoginStatus('disabled')?.message,
      'Your account has been disabled by the administrator.',
    )
    assert.equal(decideLoginStatus('missing')?.title, 'Account not found')
    assert.equal(
      decideLoginStatus('missing')?.message,
      'Your account was not found in the directory.',
    )
    assert.equal(decideLoginStatus('empty_name')?.title, 'Display name required')
    assert.equal(
      decideLoginStatus('empty_name')?.message,
      'Your account has no name in the identity provider.',
    )
    assert.equal(
      decideLoginStatus('unreachable')?.message,
      'IdP is unreachable. Login cannot be verified at this time.',
    )
    assert.equal(decideLoginStatus('rate_limited')?.title, 'Too many attempts')
    assert.match(
      decideLoginStatus('rate_limited')?.message ?? '',
      /Too many sign-in attempts/i,
    )
  })

  it('marks directory and outage surfaces as warn (shared login-status chrome)', () => {
    assert.equal(decideLoginStatus('unreachable')?.tone, 'warn')
    assert.equal(decideLoginStatus('rate_limited')?.tone, 'warn')
    assert.equal(decideLoginStatus('disabled')?.tone, 'warn')
    assert.equal(decideLoginStatus('missing')?.tone, 'warn')
    assert.equal(decideLoginStatus('empty_name')?.tone, 'warn')
  })
})

describe('loginStatusSearch', () => {
  it('builds a status query for LoginPage', () => {
    assert.equal(loginStatusSearch('empty_name'), '?status=empty_name')
  })
})
