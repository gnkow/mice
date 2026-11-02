import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLoginFlow } from './loginFlow.js'
import { createFakeDirectory } from '../directory/directoryFake.js'
import { fakeClock } from '../../clock.js'
import { createFakeOidcProvider } from './oidcFake.js'

const identity = {
  sub: 'u1',
  iss: 'https://idp.test',
  email: 'u1@example.com',
  name: 'U One',
  idToken: 'id.token.jwt',
  groups: ['devs'],
  emailVerified: true,
}

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state')!

describe('IdP access check: login', () => {
  it('blocks login when IdP userStatus returns error (IdP unreachable)', async () => {
    // ARRANGE
    const clock = fakeClock(Date.UTC(2026, 5, 1))
    const provider = createFakeOidcProvider({ claims: identity })
    const directory = createFakeDirectory({
      issuer: 'https://idp.test',
      statuses: {
        u1: 'error', // IdP unreachable
      },
    })
    const flow = createLoginFlow({ provider, directory, clock })

    // ACT
    const started = await flow.startLogin()
    const result = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })

    // ASSERT
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 500)
    assert.match(result.html, /IdP.*unreachable|could not verify|directory.*unavailable/i)
  })

  it('rejects login when principal is disabled in IdP', async () => {
    // ARRANGE
    const clock = fakeClock(Date.UTC(2026, 5, 1))
    const provider = createFakeOidcProvider({ claims: identity })
    const directory = createFakeDirectory({
      issuer: 'https://idp.test',
      statuses: {
        u1: 'disabled', // IdP reports user is disabled
      },
    })
    const flow = createLoginFlow({ provider, directory, clock })

    // ACT
    const started = await flow.startLogin()
    const result = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })

    // ASSERT
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.match(result.html, /disabled/)
  })
})
