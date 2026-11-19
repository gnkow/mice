import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupBindingKey } from './groupBinding.js'
import {
  getGroupDisplayNames,
  upsertGroupDisplayNames,
} from './groupDisplayStore.js'

const ISS = 'https://idp.example/realms/mice'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('getGroupDisplayNames', () => {
  it('returns cached names for many keys in one lookup', async () => {
    const keyA = groupBindingKey(ISS, A)
    const keyB = groupBindingKey(ISS, B)
    await upsertGroupDisplayNames([
      { bindingKey: keyA, displayName: 'Alpha', idBased: true },
      { bindingKey: keyB, displayName: 'Beta', idBased: true },
    ])

    const map = await getGroupDisplayNames([
      keyA,
      keyB,
      groupBindingKey(ISS, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    ])
    assert.equal(map.size, 2)
    assert.deepEqual(map.get(keyA), { displayName: 'Alpha', idBased: true })
    assert.deepEqual(map.get(keyB), { displayName: 'Beta', idBased: true })
  })
})
