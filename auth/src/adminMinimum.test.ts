import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ADMIN_MINIMUM_ERROR, decideAdminMinimum } from './adminMinimum.js'

describe('decideAdminMinimum (#39)', () => {
  it('refuses removing an active admin when two or fewer remain', () => {
    assert.deepEqual(decideAdminMinimum({ activeAdminIds: [1, 2], targetPrincipalId: 1 }), {
      allow: false,
      error: ADMIN_MINIMUM_ERROR,
    })
    assert.deepEqual(decideAdminMinimum({ activeAdminIds: [1, 2], targetPrincipalId: 2 }), {
      allow: false,
      error: ADMIN_MINIMUM_ERROR,
    })
    assert.deepEqual(decideAdminMinimum({ activeAdminIds: [7], targetPrincipalId: 7 }), {
      allow: false,
      error: ADMIN_MINIMUM_ERROR,
    })
  })

  it('allows removing an active admin when three or more remain', () => {
    assert.deepEqual(decideAdminMinimum({ activeAdminIds: [1, 2, 3], targetPrincipalId: 3 }), {
      allow: true,
    })
  })

  it('allows when the target is not an active admin', () => {
    assert.deepEqual(decideAdminMinimum({ activeAdminIds: [1, 2], targetPrincipalId: 99 }), {
      allow: true,
    })
  })
})
