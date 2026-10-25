import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from './clock.js'
import { createPostgresCredentialStore } from './credentialStore.js'
import { SERVICE_ISSUER } from './principal.js'
import { createCredentials } from './tokens.js'

const DAY = 86_400_000
const alice = { sub: 'alice', iss: 'test', email: 'alice@example.com', name: 'Alice' }

function setup(policy: { revoked?: boolean; serviceActive?: boolean } = {}) {
  const clock = fakeClock()
  const store = createPostgresCredentialStore()
  const state = { revoked: policy.revoked ?? false, serviceActive: policy.serviceActive ?? true }
  const creds = createCredentials({
    store,
    clock,
    isRevoked: async () => state.revoked,
    isServiceActive: async () => state.serviceActive,
  })
  return { clock, store, state, creds }
}

await describe('credential resolution over the PostgreSQL store and fake clock', async () => {
  await it('resolves until expiry, then not', async () => {
    const { clock, creds } = setup()
    const { token } = await creds.createPat(alice, 'laptop', { expiresInDays: 2 })
    assert.equal((await creds.resolvePat(token))?.sub, 'alice')
    clock.advance(2 * DAY - 1)
    assert.equal((await creds.resolvePat(token))?.sub, 'alice')
    clock.advance(1)
    assert.equal(await creds.resolvePat(token), null)
  })

  await it('denies a revoked credential', async () => {
    const { state, creds } = setup()
    const { token } = await creds.createPat(alice, 'laptop')
    state.revoked = true
    assert.equal(await creds.resolvePat(token), null)
  })

  await it('denies an inactive service principal credential', async () => {
    const { state, creds } = setup()
    const svc = { sub: 'svc-1', iss: SERVICE_ISSUER, email: '', name: 'svc' }
    const { token } = await creds.createPat(svc, 'ci')
    assert.ok(await creds.resolvePat(token))
    state.serviceActive = false
    assert.equal(await creds.resolvePat(token), null)
  })

  await it('records last use at most once per minute', async () => {
    const { clock, creds } = setup()
    const { token, pat } = await creds.createPat(alice, 'laptop')
    const lastUsed = async () => ((await creds.listPatsForUser(alice)).find((p) => p.id === pat.id))?.lastUsedAt
    await creds.resolvePat(token)
    const first = await lastUsed()
    assert.equal(first, new Date(clock.now()).toISOString())
    clock.advance(10_000)
    await creds.resolvePat(token)
    assert.equal(await lastUsed(), first)
    clock.advance(51_000)
    await creds.resolvePat(token)
    assert.equal(await lastUsed(), new Date(clock.now()).toISOString())
  })

  await it('resolution without touch does not write last use', async () => {
    const { creds } = setup()
    const { token, pat } = await creds.createPat(alice, 'laptop')
    assert.equal((await creds.resolvePat(token, { touch: false }))?.sub, 'alice')
    assert.equal(((await creds.listPatsForUser(alice)).find((p) => p.id === pat.id))?.lastUsedAt, undefined)
  })
})
