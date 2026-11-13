import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-baseline-'))
process.env.SESSION_SECRET = 'test-session-secret-for-baseline'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@test.io'
process.env.OIDC_ISSUER = 'https://idp.test'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'

const { Hono } = await import('hono')
const { registerIdpBaselineRoutes } = await import('./idpBaselineRoutes.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { env } = await import('../../env.js')
const { auditMutation } = await import('../../auditMutation.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')

const mk = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@test.io`,
  name: sub,
  sessionStart: Math.floor(Date.now() / 1000) - 30,
  emailVerified: true,
})

const idToken = (claims: Record<string, unknown>) => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part(claims)}.sig`
}

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  throw new Error(`Unexpected request: ${urlStr}`)
})

await ensureBootstrapKey()
await maybeBootstrapInstanceAdmin(mk('admin'))

const cookie = async (user: ReturnType<typeof mk>, token?: string) => {
  const sessionId = await sealSession({
    ...user,
    ...(token ? { idToken: token } : {}),
  })
  const sealed = await sealSessionCookie(sessionId)
  return `${env.cookieName}=${sealed}`
}

describe('IdP Baseline Check Routes', () => {
  let app: ReturnType<typeof Hono>

  beforeEach(async () => {
    app = new Hono()
    registerIdpBaselineRoutes(app, { audit: auditMutation })
  })

  it('registers POST /auth/admin/idp-baseline/check endpoint', async () => {
    const response = await app.request('/auth/admin/idp-baseline/check', {
      method: 'POST',
    })
    assert.equal(response.status, 401)
  })

  it('registers GET /auth/admin/idp-baseline/status endpoint', async () => {
    const response = await app.request('/auth/admin/idp-baseline/status', {
      method: 'GET',
    })
    assert.equal(response.status, 401)
  })

  it('registers GET /auth/admin/idp-baseline/history endpoint', async () => {
    const response = await app.request('/auth/admin/idp-baseline/history', {
      method: 'GET',
    })
    assert.equal(response.status, 401)
  })

  it('stores an MFA-available baseline check from the Session id_token', async () => {
    const token = idToken({ acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_700_000_000 })
    const response = await app.request('/auth/admin/idp-baseline/check', {
      method: 'POST',
      headers: {
        Cookie: await cookie(mk('admin'), token),
        'Content-Type': 'application/json',
      },
    })
    assert.equal(response.status, 200)
    const body = await response.json() as {
      mfaAvailable: boolean
      claimsFound: { acr?: string; amr: string[]; authTime?: number } | null
      error: string | null
      checkedBy: string
    }
    assert.equal(body.mfaAvailable, true)
    assert.equal(body.error, null)
    assert.equal(body.checkedBy, 'https://idp.test|admin')
    assert.deepEqual(body.claimsFound, {
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      authTime: 1_700_000_000,
    })

    const status = await app.request('/auth/admin/idp-baseline/status', {
      headers: { Cookie: await cookie(mk('admin'), token) },
    })
    assert.equal(status.status, 200)
    const statusBody = await status.json() as { lastCheck: { mfaAvailable: boolean } | null }
    assert.equal(statusBody.lastCheck?.mfaAvailable, true)
  })
})
