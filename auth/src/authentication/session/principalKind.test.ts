import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { can, kindOf } from './principal.js'

const human = { iss: 'https://idp.example', sub: 'u1' }

describe('principal kind', () => {
  it('classifies every Principal as human', () => {
    assert.equal(kindOf(human), 'human')
    assert.equal(kindOf({ iss: 'urn:mice:service', sub: 'sp-1' }), 'human')
  })

  it('a human Principal can be an admin and has favorites', () => {
    assert.equal(can(human, 'canBeAdmin'), true)
    assert.equal(can(human, 'hasFavorites'), true)
  })
})
