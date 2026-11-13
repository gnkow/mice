import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-auth-events-'))
process.env.SESSION_SECRET = 'test-session-secret-for-auth-events'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'alice@test.io'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://directory.test'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'https://idp.test'

const { Hono } = await import('hono')
const { registerAuthEventRoutes } = await import('./authEventRoutes.js')
const { registerLoginRoutes } = await import('../oidc/loginRoutes.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')

setDirectoryFetchForTests(async (input) => {
  const url = String(input)
  if (url.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200 })
  }
  if (url.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'A', lastName: 'Lice' }), {
      status: 200,
    })
  }
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
})

await ensureBootstrapKey()

const alice = {
  sub: 'alice-events',
  iss: 'https://idp.test',
  email: 'alice@test.io',
  name: 'Alice',
  emailVerified: true,
}

async function cookieFor(user: typeof alice) {
  const id = await sealSession({
    ...user,
    sessionStart: Math.floor(Date.now() / 1000) - 30,
  })
  return `${env.cookieName}=${await sealSessionCookie(id)}`
}

function app() {
  const api = new Hono()
  registerLoginRoutes(api, { audit: async () => {} })
  registerAuthEventRoutes(api)
  return api
}

describe('Auth event HTTP seam (Ticket 05)', () => {
  it('records logout through /auth/logout and surfaces it on /auth/me/events', async () => {
    const api = app()
    const cookie = await cookieFor(alice)

    const logout = await api.request('/auth/logout', {
      method: 'POST',
      headers: { cookie },
    })
    assert.equal(logout.status, 200, await logout.text().catch(() => ''))

    // Fresh session for the same Principal so we can query events.
    const again = await cookieFor(alice)
    const listed = await api.request('/auth/me/events?limit=20', {
      headers: { cookie: again },
    })
    const listedText = await listed.text()
    assert.equal(listed.status, 200, listedText)
    const body = JSON.parse(listedText) as {
      events: Array<{
        action: string
        outcome: string
        requestId: string
        hashedIp?: string
      }>
    }
    const logoutEvent = body.events.find((e) => e.action === 'logout' && e.outcome === 'success')
    assert.ok(logoutEvent, 'expected logout auth event after POST /auth/logout')
    assert.ok(logoutEvent.requestId, 'logout event carries request id')
    // clientIp is always captured on logout (at least "unknown") → hashedIp present for UI.
    assert.ok(
      logoutEvent.hashedIp && /^[0-9a-f]{64}$/i.test(logoutEvent.hashedIp),
      'logout event exposes hashedIp for profile Security Activity',
    )
  })
})
