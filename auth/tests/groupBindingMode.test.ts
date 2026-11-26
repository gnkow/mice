import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GROUP_BINDING_ID_BASED_MESSAGE,
  GROUP_BINDING_NAME_BASED_MESSAGE,
  assessGroupBindingMode,
  groupBindingAssessment,
} from '../src/packages/authz/lib/groupBindingMode.js'

describe('groupBindingAssessment', () => {
  it('sets warning only for name-based mode', () => {
    assert.deepEqual(groupBindingAssessment('id-based'), {
      mode: 'id-based',
      message: GROUP_BINDING_ID_BASED_MESSAGE,
      warning: false,
    })
    assert.deepEqual(groupBindingAssessment('name-based', 'custom warning'), {
      mode: 'name-based',
      message: 'custom warning',
      warning: true,
    })
  })
})


describe('assessGroupBindingMode', () => {
  it('detects Azure AD GUID groups as id-based', () => {
    const r = assessGroupBindingMode([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
    assert.equal(r.mode, 'id-based')
    assert.equal(r.message, GROUP_BINDING_ID_BASED_MESSAGE)
    assert.equal(r.warning, false)
  })

  it('detects Keycloak object ids as id-based', () => {
    const r = assessGroupBindingMode(['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'])
    assert.equal(r.mode, 'id-based')
    assert.equal(r.message, GROUP_BINDING_ID_BASED_MESSAGE)
    assert.equal(r.warning, false)
  })

  it('fails the check when sample groups are display names only', () => {
    const r = assessGroupBindingMode(['Quality Team', 'Engineering'])
    assert.equal(r.mode, 'id-based')
    assert.equal(r.message, GROUP_BINDING_NAME_BASED_MESSAGE)
    assert.equal(r.warning, true)
  })

  it('fails the check when the sample is empty (ids unavailable)', () => {
    const r = assessGroupBindingMode([])
    assert.equal(r.mode, 'id-based')
    assert.equal(r.message, GROUP_BINDING_NAME_BASED_MESSAGE)
    assert.equal(r.warning, true)
  })

  it('fails the check when any sample value is not an object id', () => {
    const r = assessGroupBindingMode([
      '11111111-1111-4111-8111-111111111111',
      'Quality Team',
    ])
    assert.equal(r.mode, 'id-based')
    assert.equal(r.warning, true)
    assert.equal(r.message, GROUP_BINDING_NAME_BASED_MESSAGE)
  })

  it('ignores blank samples when deciding mode', () => {
    const r = assessGroupBindingMode(['  ', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', ''])
    assert.equal(r.mode, 'id-based')
    assert.equal(r.warning, false)
  })
})
