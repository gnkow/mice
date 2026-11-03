import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GROUP_BINDING_ID_BASED_MESSAGE,
  GROUP_BINDING_NAME_BASED_MESSAGE,
  assessGroupBindingMode,
} from './groupBindingMode.js'

describe('assessGroupBindingMode', () => {
  it('detects Azure AD GUID groups as id-based', () => {
    const r = assessGroupBindingMode([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
    assert.equal(r.mode, 'id-based')
    assert.equal(r.message, GROUP_BINDING_ID_BASED_MESSAGE)
  })

  it('detects Keycloak object ids as id-based', () => {
    const r = assessGroupBindingMode(['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'])
    assert.equal(r.mode, 'id-based')
    assert.equal(r.message, GROUP_BINDING_ID_BASED_MESSAGE)
  })

  it('warns when sample groups are display names only', () => {
    const r = assessGroupBindingMode(['Quality Team', 'Engineering'])
    assert.equal(r.mode, 'name-based')
    assert.equal(r.message, GROUP_BINDING_NAME_BASED_MESSAGE)
  })

  it('treats an empty sample as name-based (ids unavailable)', () => {
    const r = assessGroupBindingMode([])
    assert.equal(r.mode, 'name-based')
    assert.equal(r.message, GROUP_BINDING_NAME_BASED_MESSAGE)
  })

  it('is name-based when any sample value is not an object id', () => {
    const r = assessGroupBindingMode([
      '11111111-1111-4111-8111-111111111111',
      'Quality Team',
    ])
    assert.equal(r.mode, 'name-based')
  })
})
