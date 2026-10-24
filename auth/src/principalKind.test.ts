import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { can, kindOf, serviceIdentity, type Capability } from './principal.js'

const human = { iss: 'https://idp.example', sub: 'u1' }
const service = serviceIdentity('sp-1')

const table: Array<[Capability, boolean, boolean]> = [
  // capability, human, service
  ['canBeAdmin', true, false],
  ['hasFavorites', true, false],
  ['canOwnServicePrincipals', true, false],
]

describe('principal kind capabilities', () => {
  it('classifies by kind', () => {
    assert.equal(kindOf(human), 'human')
    assert.equal(kindOf(service), 'service')
  })
  for (const [cap, h, s] of table) {
    it(`${cap}: human=${h}, service=${s}`, () => {
      assert.equal(can(human, cap), h)
      assert.equal(can(service, cap), s)
    })
  }
})
