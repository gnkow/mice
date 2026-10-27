import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-idp-check-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { setDirectoryFetchForTests, lookupKeycloakUserStatus } = await import('../directory/directory.js')
const { authenticate } = await import('../session/requireAuth.js')
const { sealSession } = await import('../session/session.js')
const { env } = await import('../../env.js')

const mk = (sub: string) => ({ sub, iss: 'http://localhost:8180/realms/mice', email: `${sub}@example.com`, name: sub })
const cookie = async (user: ReturnType<typeof mk> & Partial<{ sessionStart: number; disabledAt: Date; miceFlags: string[] }>) => {
  const now = Math.floor(Date.now() / 1000)
  return `${env.cookieName}=${await sealSession({
    ...user,
    sessionStart: user.sessionStart ?? now - 30,
  })}`
}

describe('Ticket 19: Live IdP Check Always (U3)', () => {
  after(() => {
    setDirectoryFetchForTests(null)
    rmSync(dataDir, { recursive: true, force: true })
  })

  describe('IdP check on every request (no throttling)', () => {
    it('checks IdP on every request', async () => {
      // Mock IdP to track calls
      let checkCount = 0
      setDirectoryFetchForTests(async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/protocol/openid-connect/token')) {
          return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
        }
        if (urlStr.includes('/users/')) {
          checkCount++
          return new Response(JSON.stringify({ enabled: true }), { status: 200 })
        }
        throw new Error(`Unexpected request: ${urlStr}`)
      })

      const user = mk('always-check-user')
      const app = new Hono()
      const sessionCookie = await cookie(user)

      app.get('/test', async (c) => {
        const auth = await authenticate(c)
        return auth.ok ? c.json({ allowed: true }) : c.json({ error: auth.error }, auth.status)
      })

      // Make multiple requests - should check IdP every time
      await app.request('/test', { headers: { Cookie: sessionCookie } })
      assert.equal(checkCount, 1, 'First request should check IdP')
      
      await app.request('/test', { headers: { Cookie: sessionCookie } })
      assert.equal(checkCount, 2, 'Second request should also check IdP (no throttling)')
      
      await app.request('/test', { headers: { Cookie: sessionCookie } })
      assert.equal(checkCount, 3, 'Third request should also check IdP')
    })

    it('returns 503 when IdP is unreachable', async () => {
      // Mock IdP to fail
      setDirectoryFetchForTests(async () => {
        throw new Error('Network error')
      })

      const user = mk('user-unreachable')
      const app = new Hono()
      const sessionCookie = await cookie(user)

      app.get('/test', async (c) => {
        const auth = await authenticate(c)
        return auth.ok ? c.json({ allowed: true }) : c.json({ error: auth.error }, auth.status)
      })

      const res = await app.request('/test', { headers: { Cookie: sessionCookie } })
      
      // Ticket #19: Should return 503 when IdP unreachable
      assert.equal(res.status, 503, 'Should return 503 when IdP is unreachable')
      const body = await res.json()
      assert.match(body.error, /Service Unavailable|IdP/i, 'Error should mention service unavailability')
    })

    it('denies access when user is disabled in IdP', async () => {
      // Mock IdP to return 'disabled'
      setDirectoryFetchForTests(async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/protocol/openid-connect/token')) {
          return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
        }
        if (urlStr.includes('/users/')) {
          return new Response(JSON.stringify({ enabled: false }), { status: 200 })
        }
        throw new Error(`Unexpected request: ${urlStr}`)
      })

      const user = mk('disabled-user')
      const app = new Hono()
      const sessionCookie = await cookie(user)

      app.get('/test', async (c) => {
        const auth = await authenticate(c)
        return auth.ok ? c.json({ allowed: true }) : c.json({ error: auth.error }, auth.status)
      })

      const res = await app.request('/test', { headers: { Cookie: sessionCookie } })
      
      // Should deny access when user is disabled (503 because IdP responded, but user not enabled)
      assert.equal(res.status, 503, 'Should return 503 when user is disabled in IdP')
      const body = await res.json()
      assert.match(body.error, /Service Unavailable|IdP/i, 'Error should mention service unavailability')
    })

    it('allows access when user is enabled in IdP', async () => {
      // Mock IdP to return 'enabled'
      setDirectoryFetchForTests(async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/protocol/openid-connect/token')) {
          return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
        }
        if (urlStr.includes('/users/')) {
          return new Response(JSON.stringify({ enabled: true }), { status: 200 })
        }
        throw new Error(`Unexpected request: ${urlStr}`)
      })

      const user = mk('enabled-user')
      const app = new Hono()
      const sessionCookie = await cookie(user)

      app.get('/test', async (c) => {
        const auth = await authenticate(c)
        return auth.ok ? c.json({ allowed: true }) : c.json({ error: auth.error }, auth.status)
      })

      const res = await app.request('/test', { headers: { Cookie: sessionCookie } })
      
      // Should allow access when user is enabled
      assert.equal(res.status, 200, 'Should allow access when user is enabled in IdP')
      const body = await res.json()
      assert.equal(body.allowed, true, 'Response should indicate access allowed')
    })
  })

  describe('Groups cached in session (8h max)', () => {
    it('uses session-cached groups for ordinary requests', async () => {
      // Mock IdP to allow access
      setDirectoryFetchForTests(async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/protocol/openid-connect/token')) {
          return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
        }
        if (urlStr.includes('/admin/realms/') && urlStr.includes('/users/')) {
          // User status check
          return new Response(JSON.stringify({ enabled: true }), { status: 200 })
        }
        throw new Error(`Unexpected request: ${urlStr}`)
      })

      const user = { ...mk('groups-cached-user'), groups: ['devs', 'admins'] }
      const app = new Hono()
      const sessionCookie = await cookie(user)

      app.get('/test', async (c) => {
        const auth = await authenticate(c)
        return auth.ok ? c.json({ groups: auth.user.groups }) : c.json({ error: auth.error }, auth.status)
      })

      const res = await app.request('/test', { headers: { Cookie: sessionCookie } })
      
      // Should use cached groups from session
      assert.equal(res.status, 200, 'Should allow access')
      const body = await res.json()
      assert.deepEqual(body.groups, ['devs', 'admins'], 'Should return session-cached groups')
    })
  })
})
