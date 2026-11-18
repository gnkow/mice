import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from '../../clock.js'
import { createFakeDirectory } from '../directory/directoryFake.js'
import { admitLoginAfterToken } from './loginAdmission.js'
import type { OidcClaims } from './oidc.js'

const DEVS = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111'
const ADMINS = 'aaaaaaaa-bbbb-4ccc-8ddd-222222222222'

const claims: OidcClaims = {
  sub: 'u1',
  iss: 'https://idp.test',
  email: 'u1@example.com',
  name: 'U One',
  idToken: 'id.token.jwt',
  groups: [DEVS],
  emailVerified: true,
}

function directoryEnabled() {
  return createFakeDirectory({
    issuer: 'https://idp.test',
    users: [
      {
        kind: 'user',
        sub: 'u1',
        iss: 'https://idp.test',
        email: 'u1@example.com',
        name: 'U One',
      },
    ],
    userGroups: { u1: [DEVS, ADMINS] },
    statuses: { u1: 'enabled' },
  })
}

describe('admitLoginAfterToken', () => {
  it('admits an enabled Principal and returns Session groups without exchanging a code', async () => {
    const clock = fakeClock(Date.UTC(2026, 5, 1))
    const result = await admitLoginAfterToken({
      user: claims,
      directory: directoryEnabled(),
      clock,
      pkce: { next: '/jobs' },
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.dest, '/jobs')
    assert.deepEqual(result.user, {
      sub: 'u1',
      iss: 'https://idp.test',
      email: 'u1@example.com',
      emailVerified: true,
      name: 'U One',
      idToken: 'id.token.jwt',
      groups: [`https://idp.test|${DEVS}`, `https://idp.test|${ADMINS}`],
    })
  })

  it('refuses a disabled directory account with the disabled surface', async () => {
    const directory = directoryEnabled()
    directory.userStatus = async () => ({ status: 'disabled', name: 'U One' })
    const result = await admitLoginAfterToken({
      user: claims,
      directory,
      clock: fakeClock(),
      pkce: {},
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.equal(result.surface, 'disabled')
    assert.match(result.html, /disabled by the administrator/)
  })
})
