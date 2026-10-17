import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'boxen-tokens-'))
process.env.AUTH_DATA_DIR = dataDir
process.env.SESSION_SECRET = 'test-session-secret-for-tokens'

const {
  createPat,
  findPatByToken,
  listPatsForUser,
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
    assert.match(token, /^boxen_pat_/)
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
    assert.equal(resolvePat('boxen_pat_notreal'), null)
    assert.equal(findPatByToken('boxen_pat_notreal'), null)
    assert.equal(resolvePat('Bearer something'), null)
  })
})
