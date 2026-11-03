import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pendingShellViewAfterSubmit, shouldRedirectPendingUser } from './pendingAccessShell'

describe('RBAC S32 no-access shell', () => {
  it('keeps pending users on the request shell with no escape routes', () => {
    assert.equal(shouldRedirectPendingUser('/pending', true), false)
    assert.equal(shouldRedirectPendingUser('/', true), true)
    assert.equal(shouldRedirectPendingUser('/profile', true), true)
    assert.equal(shouldRedirectPendingUser('/notifications', true), true)
    assert.equal(shouldRedirectPendingUser('/settings', true), true)
    assert.equal(shouldRedirectPendingUser('/profile', false), false)
  })

  it('switches to the submitted pending view after a successful request', () => {
    assert.equal(pendingShellViewAfterSubmit('request'), 'submitted')
    assert.equal(pendingShellViewAfterSubmit('submitted'), 'submitted')
  })
})
