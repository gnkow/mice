import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUTHORIZATION_ALWAYS_ON, authzEnforceReport } from './authzAlwaysOn.js'
import * as authz from './authz.js'
import { env } from './env.js'

describe('authorization is always on (#10)', () => {
  it('reports enforce: true from the single always-on seam', () => {
    assert.equal(AUTHORIZATION_ALWAYS_ON, true)
    assert.deepEqual(authzEnforceReport(), { enforce: true })
  })

  it('does not export a disable toggle', () => {
    assert.equal('isAuthzEnforce' in authz, false)
    assert.equal('AUTHZ_ENFORCE' in process.env, false)
    assert.equal('authzEnforce' in env, false)
  })
})
