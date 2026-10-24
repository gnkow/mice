import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fakeClock, useClock } from './clock.js'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-tokens-'))
process.env.AUTH_DATA_DIR = dataDir
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

describe('PAT tokens', () => {
  after(() => {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('createPat defaults source to manual and snapshots groups', () => {
    const { token, pat } = createPat(alice, 'manual-token')
    assert.match(token, /^mice_pat_/)
    assert.equal(pat.source, 'manual')
    assert.equal(pat.label, 'manual-token')

    const user = resolvePat(token)
    assert.ok(user)
    assert.deepEqual(user?.groups, ['devs'])
    assert.equal(user?.email, alice.email)

    const meta = findPatByToken(token)
    assert.ok(meta)
    assert.equal(meta?.source, 'manual')
    assert.equal(meta?.id, pat.id)
  })

  it('createPat accepts cli-login source', () => {
    const { token, pat } = createPat(alice, 'cli-login', {
      source: 'cli-login',
    })
    assert.equal(pat.source, 'cli-login')
    assert.equal(findPatByToken(token)?.source, 'cli-login')
  })

  it('createPat still accepts scopes array as third arg', () => {
    const scopes = [{ namespace: 'ns1', maxRole: 'write' as const }]
    const { token, pat } = createPat(alice, 'scoped', scopes)
    assert.ok(pat.scopes?.length)
    const user = resolvePat(token)
    assert.ok(user?.patScopes?.length)
  })

  it('listPatsForUser only returns that principal', () => {
    createPat(bob, 'bob-only')
    const aliceList = listPatsForUser(alice)
    const bobList = listPatsForUser(bob)
    assert.ok(aliceList.every((t) => t.label !== 'bob-only'))
    assert.ok(bobList.some((t) => t.label === 'bob-only'))
  })

  it('revokePat is scoped to owner', () => {
    const { pat } = createPat(alice, 'revoke-owner')
    assert.equal(revokePat(bob, pat.id), false)
    assert.equal(revokePat(alice, pat.id), true)
    assert.equal(revokePat(alice, pat.id), false)
  })

  it('revokePatByToken removes by bearer hash', () => {
    const { token } = createPat(alice, 'revoke-bearer')
    assert.ok(resolvePat(token))
    assert.equal(revokePatByToken(token), true)
    assert.equal(resolvePat(token), null)
    assert.equal(revokePatByToken(token), false)
    assert.equal(revokePatByToken('not-a-pat'), false)
  })

  it('resolvePat / findPatByToken reject unknown tokens', () => {
    assert.equal(resolvePat('mice_pat_notreal'), null)
    assert.equal(findPatByToken('mice_pat_notreal'), null)
    assert.equal(resolvePat('Bearer something'), null)
  })
})

describe('PAT expiry', () => {
  it('defaults to 90 days and rejects more than 365', () => {
    const { pat } = createPat(alice, 'default-expiry')
    const days = (Date.parse(pat.expiresAt ?? '') - Date.now()) / 86_400_000
    assert.ok(days > 89.9 && days <= 90)
    assert.throws(() => createPat(alice, 'too-long', { expiresInDays: 366 }), PatExpiryError)
    assert.throws(() => createPat(alice, 'zero', { expiresInDays: 0 }), PatExpiryError)
  })

  it('rejects an expired PAT', () => {
    const { token } = createPat(alice, 'short', { expiresInDays: 1 })
    assert.ok(resolvePat(token))
    const clock = fakeClock(Date.now() + 2 * 86_400_000)
    const restore = useClock(clock)
    try {
      assert.equal(resolvePat(token), null)
    } finally {
      restore()
    }
  })

  it('records last use', () => {
    const { token, pat } = createPat(bob, 'used')
    assert.equal(pat.lastUsedAt, undefined)
    resolvePat(token)
    const listed = listPatsForUser(bob).find((p) => p.id === pat.id)
    assert.ok(listed?.lastUsedAt)
  })

  it('debounces last-used writes to once a minute', () => {
    const { token, pat } = createPat(bob, 'debounce')
    const t0 = Date.now()
    const clock = fakeClock(t0)
    const restore = useClock(clock)
    const lastUsed = () => listPatsForUser(bob).find((p) => p.id === pat.id)?.lastUsedAt
    try {
      resolvePat(token)
      const first = lastUsed()
      assert.equal(first, new Date(t0).toISOString())
      clock.set(t0 + 10_000)
      resolvePat(token)
      assert.equal(lastUsed(), first)
      clock.set(t0 + 61_000)
      resolvePat(token)
      assert.equal(lastUsed(), new Date(t0 + 61_000).toISOString())
    } finally {
      restore()
    }
  })

  it('grandfathers legacy tokens to 365 days exactly once', () => {
    const file = join(dataDir, 'pats.json')
    const store = JSON.parse(readFileSync(file, 'utf8'))
    for (const t of store.tokens) delete t.expiresAt
    writeFileSync(file, JSON.stringify(store))
    const first = listPatsForUser(alice)
    const days = (Date.parse(first[0].expiresAt ?? '') - Date.now()) / 86_400_000
    assert.ok(days > 364.9 && days <= 365)
    const restore = useClock(fakeClock(Date.now() + 10 * 86_400_000))
    try {
      const second = listPatsForUser(alice)
      assert.deepEqual(
        second.map((p) => p.expiresAt).sort(),
        first.map((p) => p.expiresAt).sort(),
      )
    } finally {
      restore()
    }
  })
})
