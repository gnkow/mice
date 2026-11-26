import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractGroupsFromClaims,
  groupBindingKey,
  parseGroupBindingKey,
  resolveGroupClaim,
  toGroupBindingKey,
} from '../src/packages/authz/lib/groupBinding.js'

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

describe('resolveGroupClaim', () => {
  it('builds an id-based ExtractedGroup from an Azure AD GUID', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    assert.deepEqual(resolveGroupClaim('https://login.microsoftonline.com/t/v2.0/', id), {
      bindingKey: 'https://login.microsoftonline.com/t/v2.0|11111111-1111-4111-8111-111111111111',
      groupId: id,
      displayName: id,
      idBased: true,
    })
  })

  it('keeps display-name casing while normalizing the fallback id', () => {
    assert.deepEqual(resolveGroupClaim('http://kc.test/realms/mice', 'Quality Team'), {
      bindingKey: 'http://kc.test/realms/mice|quality team',
      groupId: 'quality team',
      displayName: 'Quality Team',
      idBased: false,
    })
  })

  it('re-keys an existing iss|group_id without using the caller issuer', () => {
    const key = 'https://login.microsoftonline.com/t/v2.0|aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    assert.deepEqual(resolveGroupClaim('http://ignored.example', key), {
      bindingKey: key,
      groupId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      displayName: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      idBased: true,
    })
  })
})

describe('toGroupBindingKey', () => {
  it('shares resolveGroupClaim for bare ids and already-keyed values', () => {
    const bare = toGroupBindingKey('http://kc.test/realms/mice', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    assert.deepEqual(bare, {
      bindingKey: 'http://kc.test/realms/mice|aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      groupId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      idBased: true,
    })
    const keyed = toGroupBindingKey('ignored', bare.bindingKey)
    assert.deepEqual(keyed, bare)
  })
})

describe('requireIdBasedGroupBinding', () => {
  it('accepts object ids and refuses display names', async () => {
    const { requireIdBasedGroupBinding, GROUP_OBJECT_ID_REQUIRED } = await import('../src/packages/authz/lib/groupBinding.js')
    assert.deepEqual(
      requireIdBasedGroupBinding('http://kc.test/realms/mice', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
      {
        ok: true,
        bindingKey: 'http://kc.test/realms/mice|aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        groupId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      },
    )
    assert.deepEqual(requireIdBasedGroupBinding('http://kc.test/realms/mice', 'Engineering'), {
      ok: false,
      error: GROUP_OBJECT_ID_REQUIRED,
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

  it('drops display-name claims and flags name-based fallback', () => {
    const r = extractGroupsFromClaims(['Quality Team', 'Engineering'], {
      issuer: 'http://kc.test/realms/mice',
    })
    assert.equal(r.nameBasedFallback, true)
    assert.deepEqual(r.groups, [])
  })

  it('dedupes by binding key and drops non-id samples', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const r = extractGroupsFromClaims([id, id.toUpperCase(), 'Quality Team', ''], {
      issuer: 'https://login.microsoftonline.com/t/v2.0',
    })
    assert.equal(r.nameBasedFallback, true)
    assert.equal(r.groups.length, 1)
    assert.equal(r.groups[0]!.idBased, true)
    assert.equal(r.groups[0]!.groupId, id)
  })

  it('accepts a single string claim the same way as a one-element array', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const asString = extractGroupsFromClaims(id, { issuer: 'http://kc.test/realms/mice' })
    const asArray = extractGroupsFromClaims([id], { issuer: 'http://kc.test/realms/mice' })
    assert.deepEqual(asString, asArray)
  })
})
