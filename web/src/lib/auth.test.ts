import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { fetchAuthzMe } from './auth'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function respondWith(body: unknown) {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch
}

describe('fetchAuthzMe', () => {
  const valid = {
    enforce: true,
    pending: false,
    role: 'user' as const,
    effectivePermissions: ['namespace:create'],
    permissionCatalog: ['namespace:create', 'repo:read'],
  }

  it('returns a payload that matches the contract', async () => {
    respondWith(valid)
    assert.deepEqual(await fetchAuthzMe(), valid)
  })

  it('returns null for a payload missing permissionCatalog', async () => {
    const { permissionCatalog: _drop, ...rest } = valid
    respondWith(rest)
    assert.equal(await fetchAuthzMe(), null)
  })

  it('returns null for a non-object payload', async () => {
    respondWith('nope')
    assert.equal(await fetchAuthzMe(), null)
  })
})
