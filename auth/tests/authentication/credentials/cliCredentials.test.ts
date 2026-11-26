import '../../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from '../../../src/packages/shared/lib/clock.js'
import {
  cliRefreshReply,
  createCliCredentials,
  decideCliAccessCredential,
  decideCliRefreshIdpAccess,
  decideCliRefreshTokenState,
  type IdpAccess,
} from '../../../src/packages/authentication/lib/credentials/cliCredentials.js'

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

await describe('decideCliAccessCredential', async () => {
  const base = {
    kind: 'access',
    tokenExpires: new Date(2_000),
    familyExpires: new Date(10_000),
    revokedAt: null as Date | null,
    sub: 'alice',
    iss: 'https://idp.example',
    email: 'alice@example.com',
    name: 'Alice',
    scopes: null as string[] | null,
  }

  await it('returns the SessionUser for a live access token', () => {
    assert.deepEqual(decideCliAccessCredential(base, 1_000), {
      sub: 'alice',
      iss: 'https://idp.example',
      email: 'alice@example.com',
      name: 'Alice',
    })
  })

  await it('carries scopes onto patScopes when present', () => {
    const scopes = [{ namespace: 'acme', maxRole: 'read' as const }]
    assert.deepEqual(
      decideCliAccessCredential({ ...base, scopes }, 1_000),
      {
        sub: 'alice',
        iss: 'https://idp.example',
        email: 'alice@example.com',
        name: 'Alice',
        patScopes: scopes,
      },
    )
  })

  await it('refuses missing, non-access, revoked, or expired rows', () => {
    assert.equal(decideCliAccessCredential(undefined, 1_000), null)
    assert.equal(decideCliAccessCredential({ ...base, kind: 'refresh' }, 1_000), null)
    assert.equal(
      decideCliAccessCredential({ ...base, revokedAt: new Date(500) }, 1_000),
      null,
    )
    assert.equal(decideCliAccessCredential(base, 2_000), null)
    assert.equal(
      decideCliAccessCredential({ ...base, familyExpires: new Date(500) }, 1_000),
      null,
    )
  })
})

await describe('decideCliRefreshTokenState / decideCliRefreshIdpAccess', async () => {
  const base = {
    kind: 'refresh',
    familyId: 'fam',
    tokenExpires: new Date(2_000),
    usedAt: null as Date | null,
    revokedAt: null as Date | null,
    sub: 'alice',
    iss: 'https://idp.example',
  }

  await it('allows a fresh refresh token before expiry', () => {
    assert.deepEqual(decideCliRefreshTokenState(base, 1_000), {
      allow: true,
      familyId: 'fam',
      sub: 'alice',
      iss: 'https://idp.example',
      refreshExpires: base.tokenExpires,
    })
  })

  await it('marks the family revoked on reuse of a used token', () => {
    assert.deepEqual(
      decideCliRefreshTokenState({ ...base, usedAt: new Date(500) }, 1_000),
      { allow: false, error: 'reuse', markFamilyRevoked: true },
    )
  })

  await it('refuses an expired family without revoking again', () => {
    assert.deepEqual(decideCliRefreshTokenState(base, 3_000), {
      allow: false,
      error: 'expired',
      markFamilyRevoked: false,
    })
  })

  await it('maps IdP access to refresh errors', () => {
    assert.deepEqual(decideCliRefreshIdpAccess('enabled'), { allow: true })
    assert.deepEqual(decideCliRefreshIdpAccess('disabled'), {
      allow: false,
      error: 'idp_disabled',
    })
    assert.deepEqual(decideCliRefreshIdpAccess('unreachable'), {
      allow: false,
      error: 'idp_unreachable',
    })
  })
})

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

  await it('listForUser includes the device name from issue', async () => {
    const who = { ...alice, sub: 'alice-device-name' }
    const creds = credentials()
    await creds.issue(who, undefined, { deviceName: 'desk-laptop' })
    const listed = await creds.listForUser(who)
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.deviceName, 'desk-laptop')
  })

  await it('refuses a retired personal access token without looking it up', async () => {
    assert.equal(await credentials().resolve('mice_pat_retired'), null)
    assert.deepEqual(await credentials().refresh('mice_pat_retired'), { error: 'unknown' })
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

  await it('cliRefreshReply maps rotation and IdP failures to the wire contract', async () => {
    const clock = fakeClock()
    let status: IdpAccess = 'enabled'
    const creds = createCliCredentials({ clock, idp: async () => status })
    const issued = await creds.issue(alice)
    const rotated = await creds.refresh(issued.refreshToken)
    assert.equal('accessToken' in rotated, true)
    if (!('accessToken' in rotated)) return

    assert.deepEqual(cliRefreshReply(rotated), {
      status: 200,
      body: {
        access_token: rotated.accessToken,
        refresh_token: rotated.refreshToken,
        expires_in: 8 * 60 * 60,
      },
    })
    assert.deepEqual(cliRefreshReply({ error: 'reuse' }), {
      status: 401,
      body: { error: 'reuse' },
    })
    assert.deepEqual(cliRefreshReply({ error: 'expired' }), {
      status: 401,
      body: { error: 'expired' },
    })
    assert.deepEqual(cliRefreshReply({ error: 'idp_disabled' }), {
      status: 401,
      body: { error: 'idp_disabled' },
    })
    assert.deepEqual(cliRefreshReply({ error: 'idp_unreachable' }), {
      status: 503,
      body: { error: 'idp_unreachable' },
    })

    status = 'unreachable'
    assert.deepEqual(cliRefreshReply(await creds.refresh(rotated.refreshToken)), {
      status: 503,
      body: { error: 'idp_unreachable' },
    })
  })
})
