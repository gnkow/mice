import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeEffectivePermissions } from './rbacEffective.js'

describe('RBAC S03 effective permission merge', () => {
  it('unions role bundle with custom permissions and dedupes', () => {
    const effective = mergeEffectivePermissions('external', [
      'namespace:create',
      'repo:files:read', // already in External
      'namespace:create', // duplicate custom
    ])
    assert.equal(effective.includes('namespace:list'), true) // from External
    assert.equal(effective.includes('namespace:create'), true) // custom
    assert.equal(effective.filter((p) => p === 'repo:files:read').length, 1)
    assert.equal(effective.filter((p) => p === 'namespace:create').length, 1)
    assert.equal(effective.includes('repo:files:write'), false) // not External, not custom
  })

  it('returns only custom permissions when there is no role', () => {
    assert.deepEqual(mergeEffectivePermissions(null, ['tokens:list', 'store:gc']), [
      'tokens:list',
      'store:gc',
    ])
  })
})
