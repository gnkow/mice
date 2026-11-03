import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canApproveModifiedGrant,
  canApproveRole,
  canGrantPermissions,
} from './rbacAuthority.js'
import type { InstanceRole } from './rbacRoles.js'
import { getRolePermissions } from './rbacRoles.js'

describe('RBAC S13 role approval authority', () => {
  it('lets Admin approve any role and Manager approve up to Manager', () => {
    const all: InstanceRole[] = ['external', 'user', 'manager', 'auditor', 'admin']
    for (const role of all) {
      assert.equal(canApproveRole('admin', role), true, `admin → ${role}`)
    }
    assert.equal(canApproveRole('manager', 'external'), true)
    assert.equal(canApproveRole('manager', 'user'), true)
    assert.equal(canApproveRole('manager', 'manager'), true)
    assert.equal(canApproveRole('manager', 'auditor'), false)
    assert.equal(canApproveRole('manager', 'admin'), false)
  })

  it('denies approval authority to User, External, and Auditor', () => {
    for (const reviewer of ['external', 'user', 'auditor'] as const) {
      assert.equal(canApproveRole(reviewer, 'external'), false)
      assert.equal(canApproveRole(reviewer, 'user'), false)
      assert.equal(canApproveRole(reviewer, 'manager'), false)
    }
  })
})

describe('RBAC S14 permission grant authority', () => {
  it('requires the reviewer to hold every permission being granted', () => {
    const managerPerms = getRolePermissions('manager')
    assert.equal(canGrantPermissions(managerPerms, ['namespace:create', 'access_request:review']), true)
    assert.equal(canGrantPermissions(managerPerms, ['instance:admins:add']), false)
    assert.equal(canGrantPermissions(managerPerms, ['namespace:create', 'store:gc']), false)

    const adminPerms = getRolePermissions('admin')
    assert.equal(canGrantPermissions(adminPerms, ['instance:admins:add', 'store:gc']), true)
    assert.equal(canGrantPermissions(adminPerms, ['audit:read']), false)
  })
})

describe('RBAC S15 modify-before-approve', () => {
  it('validates the granted role/perms, not the originally requested ones', () => {
    const managerPerms = getRolePermissions('manager')
    // Requested Admin, but reviewer grants User instead → allowed
    assert.equal(
      canApproveModifiedGrant({
        reviewerRole: 'manager',
        reviewerEffective: managerPerms,
        grantedRole: 'user',
        grantedPermissions: [],
      }),
      true,
    )
    // Still trying to grant Admin → blocked
    assert.equal(
      canApproveModifiedGrant({
        reviewerRole: 'manager',
        reviewerEffective: managerPerms,
        grantedRole: 'admin',
        grantedPermissions: [],
      }),
      false,
    )
    // Role ok but custom perm reviewer lacks → blocked
    assert.equal(
      canApproveModifiedGrant({
        reviewerRole: 'manager',
        reviewerEffective: managerPerms,
        grantedRole: 'user',
        grantedPermissions: ['store:gc'],
      }),
      false,
    )
    // Subset of requested customs that reviewer holds → allowed
    assert.equal(
      canApproveModifiedGrant({
        reviewerRole: 'manager',
        reviewerEffective: managerPerms,
        grantedRole: 'external',
        grantedPermissions: ['namespace:create'],
      }),
      true,
    )
  })
})
