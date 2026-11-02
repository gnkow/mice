import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from '../../clock.js'
import { createCliCredentials, type IdpAccess } from './cliCredentials.js'

const alice = {
  sub: 'alice',
  iss: 'https://idp.example',
  email: 'alice@example.com',
  name: 'Alice',
}
const HOUR = 60 * 60 * 1000

function credentials(clock = fakeClock()) {
  return createCliCredentials({
    clock,
    idp: async () => 'enabled',
  })
}

await describe('CLI credential', async () => {
  await it('issues an 8-hour access token and a refresh token that is not a PAT', async () => {
    const clock = fakeClock()
    const creds = credentials(clock)
    const issued = await creds.issue(alice)

    assert.equal(issued.expiresIn, 8 * 60 * 60)
    assert.equal(issued.accessToken.startsWith('mice_pat_'), false)
    assert.notEqual(issued.refreshToken, issued.accessToken)

    const user = await creds.resolve(issued.accessToken)
    assert.equal(user?.email, 'alice@example.com')

    clock.advance(8 * HOUR)
    assert.equal(await creds.resolve(issued.accessToken), null)
  })

  await it('refresh replaces the access token and the refresh token', async () => {
    const clock = fakeClock()
    const creds = credentials(clock)
    const issued = await creds.issue(alice)
    clock.advance(HOUR)
    const next = await creds.refresh(issued.refreshToken)
    assert.equal('accessToken' in next, true)
    if (!('accessToken' in next)) return
    assert.equal(next.expiresIn, 8 * 60 * 60)
    assert.notEqual(next.accessToken, issued.accessToken)
    assert.notEqual(next.refreshToken, issued.refreshToken)
    assert.equal((await creds.resolve(next.accessToken))?.email, alice.email)
  })

  await it('reusing a refresh token revokes the family', async () => {
    const creds = credentials()
    const issued = await creds.issue(alice)
    const next = await creds.refresh(issued.refreshToken)
    assert.equal('accessToken' in next, true)
    if (!('accessToken' in next)) return
    assert.deepEqual(await creds.refresh(issued.refreshToken), { error: 'reuse' })
    assert.equal(await creds.resolve(next.accessToken), null)
    assert.equal('accessToken' in await creds.refresh(next.refreshToken), false)
  })

  await it('refuses refresh once the family is 30 days old', async () => {
    const clock = fakeClock()
    const creds = credentials(clock)
    const issued = await creds.issue(alice)
    clock.advance(29 * 24 * HOUR)
    const rotated = await creds.refresh(issued.refreshToken)
    assert.equal('accessToken' in rotated, true)
    if (!('accessToken' in rotated)) return
    clock.advance(24 * HOUR)
    assert.deepEqual(await creds.refresh(rotated.refreshToken), { error: 'expired' })
  })

  await it('refuses refresh when the IdP disables the user or cannot be reached', async () => {
    const clock = fakeClock()
    let status: IdpAccess = 'enabled'
    const creds = createCliCredentials({ clock, idp: async () => status })
    const issued = await creds.issue(alice)

    status = 'disabled'
    assert.deepEqual(await creds.refresh(issued.refreshToken), { error: 'idp_disabled' })

    status = 'enabled'
    const rotated = await creds.refresh(issued.refreshToken)
    assert.equal('accessToken' in rotated, true)
    if (!('accessToken' in rotated)) return

    status = 'unreachable'
    assert.deepEqual(await creds.refresh(rotated.refreshToken), { error: 'idp_unreachable' })
    status = 'enabled'
    assert.equal('accessToken' in await creds.refresh(rotated.refreshToken), true)
  })

  await it('logout revokes the CLI credential and ends the web session', async () => {
    const ended: string[] = []
    const creds = createCliCredentials({
      clock: fakeClock(),
      idp: async () => 'enabled',
      endWebSessions: async (user) => {
        ended.push(`${user.iss}|${user.sub}`)
      },
    })
    const issued = await creds.issue(alice)
    assert.equal(await creds.logout(issued.accessToken), true)
    assert.equal(await creds.resolve(issued.accessToken), null)
    assert.equal('accessToken' in await creds.refresh(issued.refreshToken), false)
    assert.deepEqual(ended, [`${alice.iss}|${alice.sub}`])
    assert.equal(await creds.logout('mice_cli_missing'), false)
    assert.deepEqual(ended, [`${alice.iss}|${alice.sub}`])
  })
})
