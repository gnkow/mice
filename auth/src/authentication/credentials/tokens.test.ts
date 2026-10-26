import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock, useClock } from '../../clock.js'

process.env.SESSION_SECRET = 'test-session-secret-for-tokens'

const {
  createPat,
  findPatByToken,
  listPatsForUser,
  PatExpiryError,
  resolvePat,
  revokePat,
  revokePatByToken,
} = await import('./tokens.js')

const alice = {
  sub: 'alice',
  iss: 'test',
  email: 'alice@example.com',
  name: 'Alice',
  groups: ['devs'],
}

const bob = {
  sub: 'bob',
  iss: 'test',
  email: 'bob@example.com',
  name: 'Bob',
}

await describe('PAT tokens', async () => {
  await it('createPat defaults source to manual and snapshots groups', async () => {
    const { token, pat } = await createPat(alice, 'manual-token')
    assert.match(token, /^mice_pat_/)
    assert.equal(pat.source, 'manual')
    assert.equal(pat.label, 'manual-token')

    const user = await resolvePat(token)
    assert.ok(user)
    assert.deepEqual(user?.groups, ['devs'])
    assert.equal(user?.email, alice.email)

    const meta = await findPatByToken(token)
    assert.ok(meta)
    assert.equal(meta?.source, 'manual')
    assert.equal(meta?.id, pat.id)
  })

  await it('createPat accepts cli-login source', async () => {
    const { token, pat } = await createPat(alice, 'cli-login', {
      source: 'cli-login',
    })
    assert.equal(pat.source, 'cli-login')
    assert.equal((await findPatByToken(token))?.source, 'cli-login')
  })

  await it('createPat still accepts scopes array as third arg', async () => {
    const scopes = [{ namespace: 'ns1', maxRole: 'write' as const }]
    const { token, pat } = await createPat(alice, 'scoped', scopes)
    assert.ok(pat.scopes?.length)
    const user = await resolvePat(token)
    assert.ok(user?.patScopes?.length)
  })

  await it('listPatsForUser only returns that principal', async () => {
    await createPat(bob, 'bob-only')
    const aliceList = await listPatsForUser(alice)
    const bobList = await listPatsForUser(bob)
    assert.ok(aliceList.every((t) => t.label !== 'bob-only'))
    assert.ok(bobList.some((t) => t.label === 'bob-only'))
  })

  await it('revokePat is scoped to owner', async () => {
    const { pat } = await createPat(alice, 'revoke-owner')
    assert.equal(await revokePat(bob, pat.id), false)
    assert.equal(await revokePat(alice, pat.id), true)
    assert.equal(await revokePat(alice, pat.id), false)
  })

  await it('revokePatByToken removes by bearer hash', async () => {
    const { token } = await createPat(alice, 'revoke-bearer')
    assert.ok(await resolvePat(token))
    assert.equal(await revokePatByToken(token), true)
    assert.equal(await resolvePat(token), null)
    assert.equal(await revokePatByToken(token), false)
    assert.equal(await revokePatByToken('not-a-pat'), false)
  })

  await it('resolvePat / findPatByToken reject unknown tokens', async () => {
    assert.equal(await resolvePat('mice_pat_notreal'), null)
    assert.equal(await findPatByToken('mice_pat_notreal'), null)
    assert.equal(await resolvePat('Bearer something'), null)
  })
})

await describe('PAT expiry', async () => {
  await it('defaults to 90 days and rejects more than 365', async () => {
    const { pat } = await createPat(alice, 'default-expiry')
    const days = (Date.parse(pat.expiresAt ?? '') - Date.now()) / 86_400_000
    assert.ok(days > 89.9 && days <= 90)
    await assert.rejects(createPat(alice, 'too-long', { expiresInDays: 366 }), PatExpiryError)
    await assert.rejects(createPat(alice, 'zero', { expiresInDays: 0 }), PatExpiryError)
  })

  await it('rejects an expired PAT', async () => {
    const { token } = await createPat(alice, 'short', { expiresInDays: 1 })
    assert.ok(await resolvePat(token))
    const clock = fakeClock(Date.now() + 2 * 86_400_000)
    const restore = useClock(clock)
    try {
      assert.equal(await resolvePat(token), null)
    } finally {
      restore()
    }
  })

  await it('records last use', async () => {
    const { token, pat } = await createPat(bob, 'used')
    assert.equal(pat.lastUsedAt, undefined)
    await resolvePat(token)
    const listed = ((await listPatsForUser(bob)).find((p) => p.id === pat.id))
    assert.ok(listed?.lastUsedAt)
  })

  await it('debounces last-used writes to once a minute', async () => {
    const { token, pat } = await createPat(bob, 'debounce')
    const t0 = Date.now()
    const clock = fakeClock(t0)
    const restore = useClock(clock)
    const lastUsed = async () => ((await listPatsForUser(bob)).find((p) => p.id === pat.id))?.lastUsedAt
    try {
      await resolvePat(token)
      const first = await lastUsed()
      assert.equal(first, new Date(t0).toISOString())
      clock.set(t0 + 10_000)
      await resolvePat(token)
      assert.equal(await lastUsed(), first)
      clock.set(t0 + 61_000)
      await resolvePat(token)
      assert.equal(await lastUsed(), new Date(t0 + 61_000).toISOString())
    } finally {
      restore()
    }
  })
})
