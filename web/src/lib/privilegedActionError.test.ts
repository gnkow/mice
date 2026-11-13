import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatPrivilegedActionError } from './privilegedActionError'

describe('formatPrivilegedActionError', () => {
  it('maps Directory unavailable / 503 to directory_unavailable copy', () => {
    const a = formatPrivilegedActionError('Directory unavailable', 503)
    assert.equal(a.kind, 'directory_unavailable')
    assert.match(a.message, /Directory unavailable/i)
    assert.match(a.message, /live group check/i)

    const b = formatPrivilegedActionError('Service Unavailable - IdP check failed')
    assert.equal(b.kind, 'directory_unavailable')
  })

  it('maps Forbidden / group failures to group_invalid copy', () => {
    const a = formatPrivilegedActionError('Forbidden', 403)
    assert.equal(a.kind, 'group_invalid')
    assert.match(a.message, /Group membership is no longer valid/i)

    const b = formatPrivilegedActionError('Missing permission namespace:admin')
    assert.equal(b.kind, 'group_invalid')
    assert.match(b.message, /Missing permission/i)
  })

  it('passes through other errors', () => {
    const a = formatPrivilegedActionError('Audit system unavailable - revocation blocked')
    assert.equal(a.kind, 'other')
    assert.equal(a.message, 'Audit system unavailable - revocation blocked')
  })
})
