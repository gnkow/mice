import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from '../../clock.js'
import { createFakeDirectory } from '../directory/directoryFake.js'
import { evaluateLiveIdpAccess } from '../access/idpCheck.js'
import { createFakeOidcProvider } from './oidcFake.js'
import { createLoginFlow } from './loginFlow.js'
import { EMPTY_IDP_DISPLAY_NAME } from './idpDisplayName.js'

/**
 * Ticket 32 integration: refuse empty IdP display name at login and at the
 * authenticated-request package seam (evaluateLiveIdpAccess), without inventing
 * a name from preferred_username / email / sub.
 */

const identity = {
  sub: 'noname',
  iss: 'https://idp.test',
  email: 'noname@example.com',
  name: 'token-name-ignored',
  idToken: 'secret-id-token',
  groups: [] as string[],
  emailVerified: true,
}

await describe('empty IdP display name package seams (Ticket 32)', async () => {
  await it('refuses login when directory status name is blank; no session user', async () => {
    const clock = fakeClock(Date.UTC(2026, 5, 1))
    const provider = createFakeOidcProvider({ claims: identity })
    const directory = createFakeDirectory({
      issuer: 'https://idp.test',
      users: [
        {
          kind: 'user',
          sub: 'noname',
          iss: 'https://idp.test',
          email: 'noname@example.com',
          name: '',
        },
      ],
      statuses: { noname: 'enabled' },
    })
    const flow = createLoginFlow({ provider, directory, clock })
    const started = await flow.startLogin('/')
    const state = new URL(started.authorizeUrl).searchParams.get('state')!
    const result = await flow.completeLogin({
      code: 'auth-code',
      state,
      pkceCookie: started.pkceCookie,
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.match(result.html, new RegExp(EMPTY_IDP_DISPLAY_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })

  await it('evaluateLiveIdpAccess refuses an enabled account with a blank name', async () => {
    const result = await evaluateLiveIdpAccess(
      { sub: 'noname' },
      async () => ({ status: 'enabled', name: '   ' }),
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.equal(result.error, EMPTY_IDP_DISPLAY_NAME)
  })

  await it('allows login when the IdP status check supplies a display name', async () => {
    const clock = fakeClock(Date.UTC(2026, 5, 1))
    const provider = createFakeOidcProvider({ claims: { ...identity, sub: 'ada' } })
    const directory = createFakeDirectory({
      issuer: 'https://idp.test',
      users: [
        {
          kind: 'user',
          sub: 'ada',
          iss: 'https://idp.test',
          email: 'ada@example.com',
          name: 'Ada Lovelace',
        },
      ],
      statuses: { ada: 'enabled' },
    })
    const flow = createLoginFlow({ provider, directory, clock })
    const started = await flow.startLogin('/')
    const state = new URL(started.authorizeUrl).searchParams.get('state')!
    const result = await flow.completeLogin({
      code: 'auth-code',
      state,
      pkceCookie: started.pkceCookie,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.user.name, 'Ada Lovelace')
  })
})
