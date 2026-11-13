import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  composeIdpDisplayName,
  decideIdpDisplayNameGate,
  EMPTY_IDP_DISPLAY_NAME,
  hasIdpDisplayName,
} from './idpDisplayName.js'

describe('IdP display name', () => {
  it('composes trimmed first and last name without inventing a fallback', () => {
    assert.equal(composeIdpDisplayName({ firstName: 'Ada', lastName: 'Lovelace' }), 'Ada Lovelace')
    assert.equal(composeIdpDisplayName({ firstName: '  Ada  ', lastName: '  Lovelace ' }), 'Ada Lovelace')
    assert.equal(composeIdpDisplayName({ firstName: 'Ada', lastName: '' }), 'Ada')
    assert.equal(composeIdpDisplayName({ firstName: '', lastName: 'Lovelace' }), 'Lovelace')
    assert.equal(composeIdpDisplayName({ firstName: '  ', lastName: null }), '')
    assert.equal(composeIdpDisplayName({}), '')
  })

  it('treats blank or whitespace-only names as absent', () => {
    assert.equal(hasIdpDisplayName('Ada Lovelace'), true)
    assert.equal(hasIdpDisplayName(''), false)
    assert.equal(hasIdpDisplayName('   '), false)
  })

  it('decideIdpDisplayNameGate refuses blank names with a 403 copy', () => {
    assert.deepEqual(decideIdpDisplayNameGate('Ada'), { ok: true })
    assert.deepEqual(decideIdpDisplayNameGate(''), {
      ok: false,
      status: 403,
      error: EMPTY_IDP_DISPLAY_NAME,
    })
    assert.deepEqual(decideIdpDisplayNameGate('   '), {
      ok: false,
      status: 403,
      error: EMPTY_IDP_DISPLAY_NAME,
    })
  })
})
