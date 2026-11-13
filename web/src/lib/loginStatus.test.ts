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

  it('maps every refuse/outage code to a titled surface', () => {
    for (const code of LOGIN_STATUS_CODES) {
      const surface = decideLoginStatus(code)
      assert.ok(surface)
      assert.equal(surface.code, code)
      assert.ok(surface.title.trim())
      assert.ok(surface.message.trim())
    }
  })

  it('keeps BFF refuse copy for directory and empty-name statuses', () => {
    assert.equal(
      decideLoginStatus('disabled')?.message,
      'Your account has been disabled by the administrator.',
    )
    assert.equal(
      decideLoginStatus('missing')?.message,
      'Your account was not found in the directory.',
    )
    assert.equal(
      decideLoginStatus('empty_name')?.message,
      'Your account has no name in the identity provider.',
    )
    assert.equal(
      decideLoginStatus('unreachable')?.message,
      'IdP is unreachable. Login cannot be verified at this time.',
    )
  })

  it('marks unreachable as warn and account refuses as error', () => {
    assert.equal(decideLoginStatus('unreachable')?.tone, 'warn')
    assert.equal(decideLoginStatus('disabled')?.tone, 'error')
  })
})

describe('loginStatusSearch', () => {
  it('builds a status query for LoginPage', () => {
    assert.equal(loginStatusSearch('empty_name'), '?status=empty_name')
  })
})
