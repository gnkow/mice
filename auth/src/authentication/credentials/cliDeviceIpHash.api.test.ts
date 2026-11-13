import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

/**
 * Ticket 16 integration: device start hashes the client IP; status returns only
 * the 4-hex display suffix (never the full SHA-256).
 */

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-cli-iphash-'))
process.env.SESSION_SECRET = 'test-session-secret-for-cli-iphash'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'
process.env.PUBLIC_OXEN_REMOTE = 'http://localhost:8080'
process.env.PUBLIC_WEB_ORIGIN = 'http://localhost:5173'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { registerCliDeviceRoutes } = await import('./cliDeviceRoutes.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { assignRole } = await import('../../rbacStore.js')
const { ensurePrincipal } = await import('../session/session.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { createIpHash } = await import('../../ipHash.js')

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  if (urlStr.includes('/groups')) {
    return new Response(JSON.stringify([]), { status: 200 })
  }
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  throw new Error(`Unexpected request: ${urlStr}`)
})

const viewer = {
  sub: 'viewer1',
  iss: 'idp',
  email: 'viewer1@test.com',
  name: 'viewer1',
  emailVerified: true as const,
}
await ensurePrincipal(viewer)
assert.equal(
  (await assignRole({ actor: null, target: viewer, role: 'user', reason: 'test', bootstrap: true })).ok,
  true,
)
await ensureBootstrapKey()

const cookie = async () => {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = await sealSession({ ...viewer, sessionStart: now - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

const app = new Hono()
registerCliDeviceRoutes(app, { audit: async () => {} })

describe('hashed IP on device status (Ticket 16)', () => {
  it('start stores a hash; status returns only the 4-hex display suffix', async () => {
    const clientIp = '203.0.113.77'
    const start = await app.request('/auth/cli/device/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': clientIp,
      },
      body: JSON.stringify({}),
    })
    assert.equal(start.status, 200, await start.clone().text())
    const { user_code: userCode } = (await start.json()) as { user_code: string }
    assert.ok(userCode)

    const status = await app.request(
      `/auth/cli/device/status?user_code=${encodeURIComponent(userCode)}`,
      { headers: { cookie: await cookie() } },
    )
    assert.equal(status.status, 200, await status.clone().text())
    const body = (await status.json()) as { requestHashedIp?: string }

    assert.equal(typeof body.requestHashedIp, 'string')
    assert.equal(body.requestHashedIp!.length, 4)
    assert.match(body.requestHashedIp!, /^[0-9a-f]{4}$/)

    const full = await createIpHash().hashIp(clientIp)
    assert.ok(full)
    assert.equal(body.requestHashedIp, full.slice(-4))
    assert.notEqual(body.requestHashedIp, full)
  })
})
