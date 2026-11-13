import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideBackChannelLogoutClaims } from './backChannelLogoutClaims.js'

const EVENT = 'http://schemas.openid.net/event/backchannel-logout'

describe('decideBackChannelLogoutClaims', () => {
  it('accepts a valid logout token payload', () => {
    assert.deepEqual(
      decideBackChannelLogoutClaims({
        sub: 'alice',
        iss: 'https://idp.example',
        iat: 1_700_000_000,
        jti: 'jti-1',
        exp: 1_700_000_300,
        events: { [EVENT]: {} },
      }),
      {
        ok: true,
        sub: 'alice',
        iss: 'https://idp.example',
        jti: 'jti-1',
        iat: 1_700_000_000,
        exp: 1_700_000_300,
      },
    )
  })

  it('rejects a payload that is not a logout event', () => {
    assert.deepEqual(
      decideBackChannelLogoutClaims({
        sub: 'alice',
        iss: 'https://idp.example',
        iat: 1,
        jti: 'j',
        events: {},
      }),
      { ok: false, reason: 'not a logout event' },
    )
  })

  it('rejects a logout token that carries a nonce', () => {
    assert.deepEqual(
      decideBackChannelLogoutClaims({
        sub: 'alice',
        iss: 'https://idp.example',
        iat: 1,
        jti: 'j',
        nonce: 'n',
        events: { [EVENT]: {} },
      }),
      { ok: false, reason: 'logout_token must not carry a nonce' },
    )
  })

  it('rejects when sub, iss, iat, or jti is missing', () => {
    assert.deepEqual(
      decideBackChannelLogoutClaims({
        sub: 'alice',
        iss: 'https://idp.example',
        iat: 1,
        events: { [EVENT]: {} },
      }),
      { ok: false, reason: 'sub, iss, iat and jti required' },
    )
  })
})
