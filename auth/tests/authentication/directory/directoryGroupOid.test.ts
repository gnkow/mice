import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { directoryGroupGrantKey, mapKeycloakGroupRow } from '../../../src/packages/authentication/lib/directory/directoryGroupOid.js'

describe('directoryGroupGrantKey', () => {
  it('lowercases UUID object ids and refuses display names', () => {
    assert.equal(
      directoryGroupGrantKey('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'),
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
    assert.equal(directoryGroupGrantKey('Quality Assurance'), '')
    assert.equal(directoryGroupGrantKey('  '), '')
  })
})

describe('mapKeycloakGroupRow', () => {
  it('prefers the object id as the grant key and keeps the display name', () => {
    const hit = mapKeycloakGroupRow({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Quality Assurance',
      path: '/Quality Assurance',
    })
    assert.deepEqual(hit, {
      kind: 'group',
      group: '11111111-1111-4111-8111-111111111111',
      name: 'Quality Assurance',
    })
  })

  it('lowercases UUID object ids so grants match case-insensitive IdP ids', () => {
    const hit = mapKeycloakGroupRow({
      id: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
      name: 'Editors',
    })
    assert.equal(hit?.group, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    assert.equal(hit?.name, 'Editors')
  })

  it('skips rows without a UUID object id (name-based grants forbidden)', () => {
    assert.equal(
      mapKeycloakGroupRow({ name: 'Quality Assurance', path: '/org/Quality Assurance' }),
      null,
    )
  })

  it('returns null when neither id nor name/path can form a grant key', () => {
    assert.equal(mapKeycloakGroupRow({}), null)
    assert.equal(mapKeycloakGroupRow({ name: '   ', path: '/' }), null)
  })
})
