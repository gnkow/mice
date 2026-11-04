import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canDeleteNamespace } from './namespaceActions'

describe('namespace card actions (#06 separation of duties)', () => {
  it('lets only the namespace owner delete it', () => {
    assert.equal(canDeleteNamespace({ role: 'owner' }), true)
    assert.equal(canDeleteNamespace({ role: 'member' }), false)
    assert.equal(canDeleteNamespace({ role: null }), false)
    assert.equal(canDeleteNamespace(undefined), false)
  })
})
