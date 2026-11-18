import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideGroupRefLabel,
  groupMatchesSearch,
  parseGroupBindingKey,
} from './groupRef.ts'

describe('parseGroupBindingKey', () => {
  it('splits iss|group_id', () => {
    assert.deepEqual(
      parseGroupBindingKey(
        'http://localhost:8180/realms/mice|d2bceb2b-4e87-4c8e-9fe7-b11aa44fcd61',
      ),
      {
        iss: 'http://localhost:8180/realms/mice',
        groupId: 'd2bceb2b-4e87-4c8e-9fe7-b11aa44fcd61',
      },
    )
  })

  it('rejects non-binding keys', () => {
    assert.equal(parseGroupBindingKey('engineering'), null)
    assert.equal(parseGroupBindingKey('|only-id'), null)
    assert.equal(parseGroupBindingKey('only-iss|'), null)
  })
})

describe('decideGroupRefLabel', () => {
  const bindingKey =
    'http://localhost:8180/realms/mice|d2bceb2b-4e87-4c8e-9fe7-b11aa44fcd61'

  it('prefers display name', () => {
    assert.equal(
      decideGroupRefLabel({ bindingKey, displayName: 'test-group-091' }),
      'test-group-091',
    )
  })

  it('falls back to a short group id', () => {
    assert.equal(decideGroupRefLabel({ bindingKey }), 'd2bceb2b…')
  })
})

describe('groupMatchesSearch', () => {
  const group = {
    bindingKey:
      'http://localhost:8180/realms/mice|d2bceb2b-4e87-4c8e-9fe7-b11aa44fcd61',
    displayName: 'test-group-091',
  }

  it('matches display name and id fragments', () => {
    assert.equal(groupMatchesSearch(group, '091'), true)
    assert.equal(groupMatchesSearch(group, 'd2bceb2b'), true)
    assert.equal(groupMatchesSearch(group, 'zzz'), false)
  })

  it('matches everything when query is empty', () => {
    assert.equal(groupMatchesSearch(group, '  '), true)
  })
})
