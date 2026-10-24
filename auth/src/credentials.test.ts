import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from './clock.js'
import { createMemoryCredentialStore } from './credentialStore.js'
import { SERVICE_ISSUER } from './principal.js'
import { createCredentials } from './tokens.js'

const DAY = 86_400_000
const alice = { sub: 'alice', iss: 'test', email: 'alice@example.com', name: 'Alice' }

function setup(policy: { revoked?: boolean; serviceActive?: boolean } = {}) {
  const clock = fakeClock()
  const store = createMemoryCredentialStore()
  const state = { revoked: policy.revoked ?? false, serviceActive: policy.serviceActive ?? true }
  const creds = createCredentials({
    store,
    clock,
    isRevoked: () => state.revoked,
    isServiceActive: () => state.serviceActive,
  })
  return { clock, store, state, creds }
}

describe('credential resolution over a memory store and fake clock', () => {
  it('resolves until expiry, then not', () => {
    const { clock, creds } = setup()
    const { token } = creds.createPat(alice, 'laptop', { expiresInDays: 2 })
    assert.equal(creds.resolvePat(token)?.sub, 'alice')
    clock.advance(2 * DAY - 1)
    assert.equal(creds.resolvePat(token)?.sub, 'alice')
    clock.advance(1)
    assert.equal(creds.resolvePat(token), null)
  })

  it('denies a revoked credential', () => {
    const { state, creds } = setup()
    const { token } = creds.createPat(alice, 'laptop')
    state.revoked = true
    assert.equal(creds.resolvePat(token), null)
  })

  it('denies an inactive service principal credential', () => {
    const { state, creds } = setup()
    const svc = { sub: 'svc-1', iss: SERVICE_ISSUER, email: '', name: 'svc' }
    const { token } = creds.createPat(svc, 'ci')
    assert.ok(creds.resolvePat(token))
    state.serviceActive = false
    assert.equal(creds.resolvePat(token), null)
  })

  it('records last use at most once per minute', () => {
    const { clock, creds } = setup()
    const { token, pat } = creds.createPat(alice, 'laptop')
    const lastUsed = () => creds.listPatsForUser(alice).find((p) => p.id === pat.id)?.lastUsedAt
    creds.resolvePat(token)
    const first = lastUsed()
    assert.equal(first, new Date(clock.now()).toISOString())
    clock.advance(10_000)
    creds.resolvePat(token)
    assert.equal(lastUsed(), first)
    clock.advance(51_000)
    creds.resolvePat(token)
    assert.equal(lastUsed(), new Date(clock.now()).toISOString())
  })

  it('resolution without touch does not write last use', () => {
    const { creds } = setup()
    const { token, pat } = creds.createPat(alice, 'laptop')
    assert.equal(creds.resolvePat(token, { touch: false })?.sub, 'alice')
    assert.equal(creds.listPatsForUser(alice).find((p) => p.id === pat.id)?.lastUsedAt, undefined)
  })
})
