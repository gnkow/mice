import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeIdpDisplayName, hasIdpDisplayName } from './idpDisplayName.js'

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
})
