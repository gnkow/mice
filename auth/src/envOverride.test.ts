import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
const { env, overrideEnv } = await import('./env.js')

describe('overrideEnv', () => {
  it('changes config for the duration and restores it', () => {
    assert.equal(env.authzRequireTraining, false)
    const restore = overrideEnv({ authzRequireTraining: true })
    assert.equal(env.authzRequireTraining, true)
    restore()
    assert.equal(env.authzRequireTraining, false)
  })
})
