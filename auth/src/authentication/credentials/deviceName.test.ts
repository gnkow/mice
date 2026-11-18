import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeDeviceName } from './deviceName.js'

describe('normalizeDeviceName', () => {
  it('trims, collapses space, and bounds length', () => {
    assert.equal(normalizeDeviceName('  desk  top  '), 'desk top')
    assert.equal(normalizeDeviceName('x'.repeat(80))?.length, 64)
    assert.equal(normalizeDeviceName(''), null)
    assert.equal(normalizeDeviceName('   '), null)
    assert.equal(normalizeDeviceName(1), null)
  })
})
