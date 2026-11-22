import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { fetchAuthzMe, logoutRedirectHref } from './auth'

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

describe('logoutRedirectHref', () => {
  it('prefers IdP end-session when present', () => {
    assert.equal(
      logoutRedirectHref({ idpLogoutUrl: 'http://idp.example/logout' }),
      'http://idp.example/logout',
    )
  })

  it('falls back to /login when IdP URL is missing', () => {
    assert.equal(logoutRedirectHref({ idpLogoutUrl: null }), '/login')
    assert.equal(logoutRedirectHref({ idpLogoutUrl: '' }), '/login')
  })
})
