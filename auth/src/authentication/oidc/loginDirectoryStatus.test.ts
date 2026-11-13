import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideLoginDirectoryStatus } from './loginDirectoryStatus.js'

describe('decideLoginDirectoryStatus', () => {
  it('allows an enabled directory account', () => {
    assert.deepEqual(decideLoginDirectoryStatus('enabled'), { allow: true })
  })

  it('refuses a disabled account with 403 and records IdP-disabled', () => {
    assert.deepEqual(decideLoginDirectoryStatus('disabled'), {
      allow: false,
      httpStatus: 403,
      message: 'Your account has been disabled by the administrator.',
      recordDisabled: true,
    })
  })

  it('refuses a missing account with 403 and does not record IdP-disabled', () => {
    assert.deepEqual(decideLoginDirectoryStatus('missing'), {
      allow: false,
      httpStatus: 403,
      message: 'Your account was not found in the directory.',
      recordDisabled: false,
    })
  })

  it('refuses when the directory is unreachable with 503', () => {
    assert.deepEqual(decideLoginDirectoryStatus('error'), {
      allow: false,
      httpStatus: 503,
      message: 'IdP is unreachable. Login cannot be verified at this time.',
      recordDisabled: false,
    })
  })
})
