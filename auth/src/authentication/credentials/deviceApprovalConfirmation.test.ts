import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-device-confirm-'))
process.env.SESSION_SECRET = 'test-session-secret-for-device-confirm'
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
const { startDeviceAuth } = await import('./cliDevice.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')

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

const admin = { sub: 'admin1', iss: 'idp', email: 'admin1@test.com', name: 'admin1', emailVerified: true }
await maybeBootstrapInstanceAdmin(admin)

const cookie = async () => {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = await sealSession({ ...admin, sessionStart: now - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

const app = new Hono()
registerCliDeviceRoutes(app, { audit: async () => {} })

async function approve(userCode: string, confirmation: string) {
  return app.request('/auth/cli/device/approve', {
    method: 'POST',
    headers: { cookie: await cookie(), 'content-type': 'application/json' },
    body: JSON.stringify({ user_code: userCode, confirmation }),
  })
}

async function deviceStatus(userCode: string) {
  const res = await app.request(`/auth/cli/device/status?user_code=${encodeURIComponent(userCode)}`, {
    headers: { cookie: await cookie() },
  })
  return res.json() as Promise<{ status: string }>
}

describe('device approval confirmation', () => {
  it('returns 400 and leaves the device pending when the confirmation is neither APPROVE nor the user code', async () => {
    await ensureBootstrapKey()
    const started = await startDeviceAuth()
    const res = await approve(started.user_code, 'yes')
    assert.equal(res.status, 400)
    assert.equal((await deviceStatus(started.user_code)).status, 'pending')
  })

  it('approves a pending device when the confirmation is APPROVE', async () => {
    await ensureBootstrapKey()
    const started = await startDeviceAuth()
    const res = await approve(started.user_code, 'APPROVE')
    const text = await res.text()
    assert.equal(res.status, 200, text)
    assert.equal((await deviceStatus(started.user_code)).status, 'approved')
  })

  it('approves a pending device when the confirmation is the user code', async () => {
    await ensureBootstrapKey()
    const started = await startDeviceAuth()
    const res = await approve(started.user_code, started.user_code.toLowerCase())
    const text = await res.text()
    assert.equal(res.status, 200, text)
    assert.equal((await deviceStatus(started.user_code)).status, 'approved')
  })
})
