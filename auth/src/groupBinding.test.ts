import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractGroupsFromClaims,
  groupBindingKey,
  parseGroupBindingKey,
} from './groupBinding.js'

describe('groupBindingKey', () => {
  it('stores iss|group_id with a canonical issuer', () => {
    assert.equal(
      groupBindingKey('https://login.microsoftonline.com/t/v2.0/', '11111111-1111-4111-8111-111111111111'),
      'https://login.microsoftonline.com/t/v2.0|11111111-1111-4111-8111-111111111111',
    )
  })

  it('round-trips through parseGroupBindingKey', () => {
    const key = groupBindingKey('http://kc.test/realms/mice', 'abc-id')
    assert.deepEqual(parseGroupBindingKey(key), {
      iss: 'http://kc.test/realms/mice',
      groupId: 'abc-id',
    })
  })
})

describe('extractGroupsFromClaims', () => {
  it('treats Azure AD GUID groups as id-based', () => {
    const r = extractGroupsFromClaims(
      ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      { issuer: 'https://login.microsoftonline.com/t/v2.0' },
    )
    assert.equal(r.nameBasedFallback, false)
    assert.deepEqual(r.groups.map((g) => g.bindingKey), [
      'https://login.microsoftonline.com/t/v2.0|11111111-1111-4111-8111-111111111111',
      'https://login.microsoftonline.com/t/v2.0|22222222-2222-4222-8222-222222222222',
    ])
    assert.ok(r.groups.every((g) => g.idBased))
  })

  it('treats Keycloak object ids as id-based', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const r = extractGroupsFromClaims([id], {
      issuer: 'http://kc.test/realms/mice',
    })
    assert.equal(r.nameBasedFallback, false)
    assert.equal(r.groups[0]!.bindingKey, `http://kc.test/realms/mice|${id}`)
    assert.equal(r.groups[0]!.idBased, true)
  })

  it('falls back to normalized names with a warning when claims are display names', () => {
    const r = extractGroupsFromClaims(['Quality Team', 'Engineering'], {
      issuer: 'http://kc.test/realms/mice',
    })
    assert.equal(r.nameBasedFallback, true)
    assert.deepEqual(r.groups.map((g) => ({ key: g.bindingKey, idBased: g.idBased, name: g.displayName })), [
      {
        key: 'http://kc.test/realms/mice|quality team',
        idBased: false,
        name: 'Quality Team',
      },
      {
        key: 'http://kc.test/realms/mice|engineering',
        idBased: false,
        name: 'Engineering',
      },
    ])
  })
})
