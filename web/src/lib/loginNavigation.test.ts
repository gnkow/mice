import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  loginRedirectSearch,
  safeLoginReturnPath,
  ssoLoginHref,
} from './loginNavigation'

describe('safeLoginReturnPath', () => {
  it('defaults missing or unsafe paths to /', () => {
    assert.equal(safeLoginReturnPath(null), '/')
    assert.equal(safeLoginReturnPath(''), '/')
    assert.equal(safeLoginReturnPath('https://evil.example/'), '/')
    assert.equal(safeLoginReturnPath('//evil.example'), '/')
    assert.equal(safeLoginReturnPath('/login'), '/')
    assert.equal(safeLoginReturnPath('/login?x=1'), '/')
  })

  it('keeps same-site relative return paths', () => {
    assert.equal(safeLoginReturnPath('/n/acme'), '/n/acme')
    assert.equal(safeLoginReturnPath('/cli/device?user_code=abc'), '/cli/device?user_code=abc')
  })
})

describe('ssoLoginHref', () => {
  it('starts IdP login with prompt=login', () => {
    assert.equal(ssoLoginHref('/'), '/auth/login?prompt=login')
  })

  it('forwards a non-root return path as next', () => {
    assert.equal(
      ssoLoginHref('/n/acme'),
      '/auth/login?prompt=login&next=%2Fn%2Facme',
    )
  })
})

describe('loginRedirectSearch', () => {
  it('omits next when returning to home', () => {
    assert.equal(loginRedirectSearch('/'), '')
    assert.equal(loginRedirectSearch(''), '')
  })

  it('encodes the current location as next', () => {
    assert.equal(
      loginRedirectSearch('/n/acme?tab=settings'),
      '?next=%2Fn%2Facme%3Ftab%3Dsettings',
    )
  })
})
