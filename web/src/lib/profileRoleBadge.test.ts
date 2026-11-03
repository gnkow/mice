import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { profileRoleBadge, upgradeableRoles } from './profileRoleBadge'

describe('RBAC S34 profile role badge', () => {
  it('labels formal roles and Pending when there is no role', () => {
    assert.equal(profileRoleBadge({ role: 'admin', pending: false }), 'Admin')
    assert.equal(profileRoleBadge({ role: 'manager', pending: false }), 'Manager')
    assert.equal(profileRoleBadge({ role: 'user', pending: false }), 'User')
    assert.equal(profileRoleBadge({ role: 'auditor', pending: false }), 'Auditor')
    assert.equal(profileRoleBadge({ role: 'external', pending: false }), 'External User')
    assert.equal(profileRoleBadge({ role: null, pending: true }), 'Pending')
  })

  it('lists upgradeable roles above the caller\'s current role', () => {
    assert.deepEqual(upgradeableRoles(null), ['external', 'user', 'manager'])
    assert.deepEqual(upgradeableRoles('external'), ['user', 'manager'])
    assert.deepEqual(upgradeableRoles('user'), ['manager'])
    assert.deepEqual(upgradeableRoles('manager'), [])
    assert.deepEqual(upgradeableRoles('admin'), [])
  })
})
