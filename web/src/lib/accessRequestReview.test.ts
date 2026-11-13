import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  APPROVABLE_BY_MANAGER,
  approvableRoles,
  buildApproveBody,
  buildDenyBody,
  filterAccessRequests,
  formatRequestedAccess,
  isAdminFloorError,
  isAuthorityError,
} from './accessRequestReview'

const row = (partial: {
  id: string
  status: string
  requestedRole?: string | null
  requestedPermissions?: string[]
  message?: string
}) => ({
  id: partial.id,
  sub: 'u',
  iss: 'https://idp.test',
  email: 'u@example.com',
  name: 'User',
  message: partial.message ?? 'please',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: partial.status,
  requestedRole: partial.requestedRole ?? null,
  requestedPermissions: partial.requestedPermissions ?? [],
})

describe('RBAC S35 access request review helpers', () => {
  it('filters the list by status', () => {
    const rows = [
      row({ id: '1', status: 'pending' }),
      row({ id: '2', status: 'approved' }),
      row({ id: '3', status: 'denied' }),
      row({ id: '4', status: 'pending' }),
    ]
    assert.deepEqual(
      filterAccessRequests(rows, 'pending').map((r) => r.id),
      ['1', '4'],
    )
    assert.deepEqual(
      filterAccessRequests(rows, 'approved').map((r) => r.id),
      ['2'],
    )
    assert.deepEqual(
      filterAccessRequests(rows, 'denied').map((r) => r.id),
      ['3'],
    )
    assert.deepEqual(
      filterAccessRequests(rows, 'all').map((r) => r.id),
      ['1', '2', '3', '4'],
    )
  })

  it('summarizes requested role and permissions for the list', () => {
    assert.equal(
      formatRequestedAccess({
        requestedRole: 'manager',
        requestedPermissions: [],
      }),
      'Manager',
    )
    assert.equal(
      formatRequestedAccess({
        requestedRole: null,
        requestedPermissions: ['namespace:create', 'audit:read'],
      }),
      'namespace:create, audit:read',
    )
    assert.equal(
      formatRequestedAccess({
        requestedRole: 'user',
        requestedPermissions: ['audit:read'],
      }),
      'User + audit:read',
    )
  })

  it('lists roles a reviewer may grant (modify-before-approve)', () => {
    assert.deepEqual(approvableRoles('manager'), [...APPROVABLE_BY_MANAGER])
    assert.deepEqual(approvableRoles('admin'), [
      'external',
      'user',
      'manager',
      'auditor',
      'admin',
    ])
    assert.deepEqual(approvableRoles('user'), [])
  })

  it('builds approve body with expiry and optional modified grant', () => {
    const expiresAt = 1_700_000_000_000
    assert.deepEqual(
      buildApproveBody({
        expiresAt,
        grantedRole: 'user',
        grantedPermissions: [],
        reason: '',
      }),
      {
        ok: true,
        body: { action: 'approve', expiresAt, grantedRole: 'user', grantedPermissions: [] },
      },
    )
    assert.deepEqual(
      buildApproveBody({
        expiresAt,
        grantedRole: null,
        grantedPermissions: ['namespace:create'],
        reason: '  ok  ',
      }),
      {
        ok: true,
        body: {
          action: 'approve',
          expiresAt,
          grantedRole: null,
          grantedPermissions: ['namespace:create'],
          reason: 'ok',
        },
      },
    )
    assert.equal(
      buildApproveBody({
        expiresAt: 0,
        grantedRole: 'user',
        grantedPermissions: [],
        reason: '',
      }).ok,
      false,
    )
  })

  it('requires a denial reason and surfaces authority errors', () => {
    assert.equal(buildDenyBody({ reason: '   ' }).ok, false)
    assert.deepEqual(buildDenyBody({ reason: ' not yet ' }), {
      ok: true,
      body: { action: 'deny', reason: 'not yet' },
    })
    assert.equal(isAuthorityError('Forbidden: insufficient approval authority'), true)
    assert.equal(isAuthorityError('Insufficient authority to grant this permission'), true)
    assert.equal(isAuthorityError('Already resolved'), false)
    assert.equal(isAdminFloorError('At least two admins must remain'), true)
    assert.equal(isAdminFloorError('At least two instance admins must remain'), true)
    assert.equal(isAdminFloorError('Grant failed'), false)
  })
})
