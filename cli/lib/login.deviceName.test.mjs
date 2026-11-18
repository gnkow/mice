import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultDeviceName } from './login.mjs'

describe('defaultDeviceName', () => {
  it('uses hostname, falls back, and bounds length', () => {
    assert.equal(defaultDeviceName('desk-top'), 'desk-top')
    assert.equal(defaultDeviceName('  desk  top  '), 'desk top')
    assert.equal(defaultDeviceName(''), 'mice-cli')
    assert.equal(defaultDeviceName('   '), 'mice-cli')
    assert.equal(defaultDeviceName('x'.repeat(80)).length, 64)
  })
})
