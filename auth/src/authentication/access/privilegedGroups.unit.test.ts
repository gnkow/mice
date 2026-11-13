import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupBindingKey } from '../../groupBinding.js'
import {
  directoryLiveGroupKeys,
  intersectSessionWithDirectoryGroups,
} from './privilegedGroups.js'

const ISS = 'http://kc.test/realms/mice'
const GROUP = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

describe('directoryLiveGroupKeys', () => {
  it('indexes object id, normalized name, and binding key for each listed group', () => {
    const live = directoryLiveGroupKeys([{ id: GROUP, name: 'Quality Assurance' }], ISS)
    assert.equal(live.has(GROUP), true)
    assert.equal(live.has('quality assurance'), true)
    assert.equal(live.has(groupBindingKey(ISS, GROUP)), true)
    assert.equal(live.has(OTHER), false)
  })
})

describe('intersectSessionWithDirectoryGroups', () => {
  it('keeps session groups the directory still lists by object id', () => {
    const kept = intersectSessionWithDirectoryGroups(
      [GROUP, OTHER],
      [{ id: GROUP, name: 'Quality' }],
      ISS,
    )
    assert.deepEqual(kept, [GROUP])
  })

  it('keeps binding-key session groups when the directory lists the object id', () => {
    const key = groupBindingKey(ISS, GROUP)
    const kept = intersectSessionWithDirectoryGroups(
      [key],
      [{ id: GROUP, name: 'Quality' }],
      ISS,
    )
    assert.deepEqual(kept, [key])
  })

  it('drops session groups the directory no longer lists', () => {
    const kept = intersectSessionWithDirectoryGroups(
      [GROUP],
      [{ id: OTHER, name: 'Other' }],
      ISS,
    )
    assert.deepEqual(kept, [])
  })

  it('does not add directory groups that were never on the session', () => {
    const kept = intersectSessionWithDirectoryGroups(
      [GROUP],
      [
        { id: GROUP, name: 'Quality' },
        { id: OTHER, name: 'Newcomers' },
      ],
      ISS,
    )
    assert.deepEqual(kept, [GROUP])
  })
})
