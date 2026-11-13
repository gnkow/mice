import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-session-cap-'))
process.env.SESSION_SECRET = 'test-session-secret-for-session-cap'
process.env.AUTH_DEV_MODE = 'true'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'capper@test.io'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://directory.test'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'https://idp.test'

const { Hono } = await import('hono')
const { registerDevSessionRoutes } = await import('./devSessionRoutes.js')
const { registerWebSessionRoutes } = await import('./webSessionRoutes.js')
const { ensureBootstrapKey } = await import('./sealKeys.js')
const { env } = await import('../../env.js')
const { queryAudit } = await import('../../audit.js')
const { WEB_SESSION_CAP } = await import('./sessionCap.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')

setDirectoryFetchForTests(async (input) => {
  const url = String(input)
  if (url.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200 })
  }
  if (url.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Cap', lastName: 'Per' }), {
      status: 200,
    })
  }
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
})

await ensureBootstrapKey()

function app() {
  const api = new Hono()
  registerDevSessionRoutes(api)
  registerWebSessionRoutes(api)
  return api
}

describe('Session cap HTTP seam (Ticket 15)', () => {
  it('sixth /auth/dev/session mint for one Principal evicts the oldest (cap-exceeded)', async () => {
    const api = app()
    const principal = {
      sub: `cap-${Date.now()}`,
      iss: 'https://idp.test',
      email: 'capper@test.io',
      name: 'Cap Per',
    }

    const minted: string[] = []
    for (let i = 0; i < WEB_SESSION_CAP + 1; i++) {
      const res = await api.request('/auth/dev/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...principal, role: 'user' }),
      })
      const text = await res.text()
      assert.equal(res.status, 200, text)
      const body = JSON.parse(text) as { cookieName: string; cookieValue: string }
      minted.push(body.cookieValue)
    }

    const cookie = `${env.cookieName}=${minted[minted.length - 1]!}`
    const listed = await api.request('/auth/sessions/web', { headers: { cookie } })
    const listedText = await listed.text()
    assert.equal(listed.status, 200, listedText)
    const sessions = (JSON.parse(listedText) as { sessions: Array<{ id: string }> }).sessions
    assert.equal(sessions.length, WEB_SESSION_CAP)

    const { events } = await queryAudit({ action: 'session.evict', limit: 50 })
    assert.ok(
      events.some((e) => e.detail?.reason === 'cap-exceeded' && e.detail?.cap === WEB_SESSION_CAP),
      'expected session.evict with reason cap-exceeded',
    )
    assert.ok(
      events.some((e) => typeof e.detail?.evictedSessionHash === 'string'),
      'eviction names an evicted session hash',
    )
  })
})
