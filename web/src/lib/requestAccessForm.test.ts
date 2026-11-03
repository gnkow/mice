import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  REQUESTABLE_ROLES,
  buildAccessRequestPayload,
  type RequestAccessFormState,
} from './requestAccessForm'

describe('RBAC S33 Request Access form payload', () => {
  it('exposes External, User, and Manager as requestable roles', () => {
    assert.deepEqual(
      REQUESTABLE_ROLES.map((r) => r.id),
      ['external', 'user', 'manager'],
    )
  })

  it('builds a role request from radios + justification', () => {
    const state: RequestAccessFormState = {
      mode: 'role',
      role: 'manager',
      permissions: [],
      message: 'Need to approve teammates',
    }
    assert.deepEqual(buildAccessRequestPayload(state), {
      ok: true,
      payload: {
        message: 'Need to approve teammates',
        requestedRole: 'manager',
      },
    })
  })

  it('builds a custom-permission request from the multi-select', () => {
    const state: RequestAccessFormState = {
      mode: 'custom',
      role: 'user',
      permissions: ['namespace:create', 'audit:read'],
      message: 'Need create + audit',
    }
    assert.deepEqual(buildAccessRequestPayload(state), {
      ok: true,
      payload: {
        message: 'Need create + audit',
        requestedPermissions: ['namespace:create', 'audit:read'],
      },
    })
  })

  it('rejects empty justification or empty custom selection', () => {
    assert.equal(
      buildAccessRequestPayload({
        mode: 'role',
        role: 'user',
        permissions: [],
        message: '   ',
      }).ok,
      false,
    )
    assert.equal(
      buildAccessRequestPayload({
        mode: 'custom',
        role: 'user',
        permissions: [],
        message: 'please',
      }).ok,
      false,
    )
  })
})
