import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.OIDC_CLIENT_ID = 'mice-web'
const { validateIdTokenClaims } = await import('./oidc.js')
const { ID_TOKEN_LEEWAY_SEC } = await import('./oidcClaims.js')
const { sealSession, openSession } = await import('../session/session.js')

const now = 1_800_000_000
const expected = {
  issuers: ['https://idp.example/realms/mice'],
  audience: 'mice-web',
  nonce: 'n1',
  nowSec: now,
}
const valid = {
  iss: 'https://idp.example/realms/mice',
  aud: 'mice-web',
  exp: now + 300,
  nonce: 'n1',
  auth_time: now - 5,
}

describe('id_token claim validation', () => {
  it('accepts a valid token (string or array audience)', () => {
    validateIdTokenClaims(valid, expected)
    validateIdTokenClaims({ ...valid, aud: ['other', 'mice-web'] }, expected)
  })

  it('rejects a wrong issuer', () => {
    assert.throws(() => validateIdTokenClaims({ ...valid, iss: 'https://evil' }, expected), /issuer/)
    const { iss: _omit, ...noIss } = valid
    assert.throws(() => validateIdTokenClaims(noIss, expected), /issuer/)
  })

  it('rejects a wrong audience', () => {
    assert.throws(() => validateIdTokenClaims({ ...valid, aud: 'other' }, expected), /audience/)
  })

  it('rejects an expired or missing exp', () => {
    assert.throws(() => validateIdTokenClaims({ ...valid, exp: now - ID_TOKEN_LEEWAY_SEC - 1 }, expected), /expired/)
    const { exp: _omit, ...noExp } = valid
    assert.throws(() => validateIdTokenClaims(noExp, expected), /expired/)
  })

  it('rejects a mismatched or missing nonce', () => {
    assert.throws(() => validateIdTokenClaims({ ...valid, nonce: 'n2' }, expected), /nonce/)
    const { nonce: _omit, ...noNonce } = valid
    assert.throws(() => validateIdTokenClaims(noNonce, expected), /nonce/)
  })

  it('tolerates a missing auth_time', () => {
    const { auth_time: _omit, ...noAuth } = valid
    validateIdTokenClaims(noAuth, expected)
  })
})

describe('Session auth_time', () => {
  const user = { sub: 's', iss: 'i', email: 'a@x.io', name: 'A' }

  it('carries auth_time through the Session', async () => {
    const opened = await openSession(await sealSession({ ...user, authTime: 1234 }))
    assert.equal(opened?.authTime, 1234)
  })

  it('records an absent auth_time as absent', async () => {
    const opened = await openSession(await sealSession(user))
    assert.equal(opened?.authTime, undefined)
  })
})
