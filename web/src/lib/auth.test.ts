import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { INSTANCE_PERMISSIONS } from './authzContract'
import { fetchAuthzMe } from './auth'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function respondWith(body: unknown) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch
}

describe('fetchAuthzMe', () => {
  const permissions = Object.fromEntries(INSTANCE_PERMISSIONS.map((p) => [p, false]))
  const valid = { enforce: true, pending: false, instanceAdmin: false, permissions, hasAnyGrant: false }

  it('returns a payload that matches the contract', async () => {
    respondWith(valid)
    assert.deepEqual(await fetchAuthzMe(), valid)
  })

  it('returns null for a payload missing a catalog permission', async () => {
    const { session_admin: _drop, ...rest } = permissions
    respondWith({ ...valid, permissions: rest })
    assert.equal(await fetchAuthzMe(), null)
  })

  it('returns null for a non-object payload', async () => {
    respondWith('nope')
    assert.equal(await fetchAuthzMe(), null)
  })
})
