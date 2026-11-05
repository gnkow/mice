import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  initialPendingShellView,
  pendingRequestAccessSummary,
  pendingShellViewAfterSubmit,
  shouldRedirectPendingUser,
} from './pendingAccessShell'

describe('RBAC S32 no-access shell', () => {
  it('keeps pending users on the request shell with no escape routes', () => {
    assert.equal(shouldRedirectPendingUser('/pending', true), false)
    assert.equal(shouldRedirectPendingUser('/', true), true)
    assert.equal(shouldRedirectPendingUser('/profile', true), true)
    assert.equal(shouldRedirectPendingUser('/notifications', true), true)
    assert.equal(shouldRedirectPendingUser('/settings', true), true)
    assert.equal(shouldRedirectPendingUser('/profile', false), false)
  })

  it('opens on the submitted view when a pending request already exists', () => {
    assert.equal(initialPendingShellView(true), 'submitted')
    assert.equal(initialPendingShellView(false), 'request')
  })

  it('switches to the submitted pending view after a successful request', () => {
    assert.equal(pendingShellViewAfterSubmit('request'), 'submitted')
    assert.equal(pendingShellViewAfterSubmit('submitted'), 'submitted')
  })

  it('summarizes role or custom permission requests for the success card', () => {
    assert.equal(
      pendingRequestAccessSummary({
        requestedRole: 'manager',
        roleLabel: 'Manager',
      }),
      'Manager',
    )
    assert.equal(
      pendingRequestAccessSummary({
        requestedPermissions: ['repo:read'],
      }),
      '1 permission',
    )
  })
})
