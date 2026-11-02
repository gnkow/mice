import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-access-review-'))
process.env.SESSION_SECRET = 'test-session-secret-for-access-review'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { registerAccessReviewRoutes } = await import('./accessReviewRoutes.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { getDb } = await import('../../db/database.js')
const { principals } = await import('../../db/schema.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { queryAudit } = await import('../../audit.js')

// Mock IdP to always return enabled
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

const mk = (sub: string) => ({ 
  sub, 
  iss: 'idp', 
  email: `${sub}@test.com`, 
  name: sub,
})

// Bootstrap an admin
const admin = { ...mk('admin1'), emailVerified: true }
await maybeBootstrapInstanceAdmin(admin)

const cookie = async (user: ReturnType<typeof mk>) => {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = await sealSession({
    ...user,
    sessionStart: now - 30,
  })
  const sealed = await sealSessionCookie(sessionId)
  return `${env.cookieName}=${sealed}`
}
const json = { 'content-type': 'application/json' }

describe('Access Review Routes (Issue #12)', () => {
  describe('POST /auth/admin/access-review/generate', () => {
    it('registers the route', async () => {
      // Smoke test: Verify route exists (returns 401 when not authenticated, not 404)
      const app = new Hono()
      registerAccessReviewRoutes(app, { audit: async () => {} })
      
      const res = await app.request('/auth/admin/access-review/generate', {
        method: 'POST',
      })
      
      // Should return 401 (unauthenticated) not 404 (not found)
      assert.equal(res.status, 401)
    })
    
    it('includes each Principal, with roles, grants, and last login', async () => {
      await ensureBootstrapKey()
      const loginAt = 1_700_000_000
      await sealSession({
        ...mk('scientist'),
        emailVerified: true,
        sessionStart: loginAt,
      })
      const app = new Hono()
      registerAccessReviewRoutes(app, { audit: async () => {} })
      const res = await app.request('/auth/admin/access-review/generate', {
        method: 'POST',
        headers: { cookie: await cookie(admin), ...json },
        body: JSON.stringify({ quarter: '2026-Q1' }),
      })
      const text = await res.text()
      assert.equal(res.status, 200, text)
      const body = JSON.parse(text) as {
        report: { principals: Array<{ principal: { sub: string }; roles: string[]; grants: string[]; lastLogin?: number }> }
      }
      const row = body.report.principals.find((p) => p.principal.sub === 'scientist')
      assert.ok(row)
      assert.deepEqual(row.roles, [])
      assert.deepEqual(row.grants, [])
      assert.equal(row.lastLogin, 1_700_000_000_000)
    })

    it('returns the stored report when the same quarter is generated again', async () => {
      await ensureBootstrapKey()
      const app = new Hono()
      registerAccessReviewRoutes(app, { audit: async () => {} })
      const headers = { cookie: await cookie(admin), ...json }
      const send = () =>
        app.request('/auth/admin/access-review/generate', {
          method: 'POST',
          headers,
          body: JSON.stringify({ quarter: '2026-Q2' }),
        })
      const firstText = await (await send()).text()
      const first = JSON.parse(firstText) as { report: { reportId: string; generatedAt: number; principals: Array<{ principal: { sub: string } }> } }
      await sealSession({ ...mk('latecomer'), emailVerified: true, sessionStart: 1_700_001_000 })
      const secondText = await (await send()).text()
      const second = JSON.parse(secondText) as typeof first
      assert.equal(second.report.reportId, first.report.reportId)
      assert.equal(second.report.generatedAt, first.report.generatedAt)
      assert.equal(second.report.principals.some((p) => p.principal.sub === 'latecomer'), false)
    })

    it('opens a stored report and audits the generate and the read', async () => {
      await ensureBootstrapKey()
      const app = new Hono()
      registerAccessReviewRoutes(app, { audit: async () => {} })
      const headers = { cookie: await cookie(admin), ...json }
      const createdText = await (
        await app.request('/auth/admin/access-review/generate', {
          method: 'POST',
          headers,
          body: JSON.stringify({ quarter: '2026-Q3' }),
        })
      ).text()
      const created = JSON.parse(createdText) as { report: { reportId: string } }
      const openedRes = await app.request('/auth/admin/access-review/2026-Q3', {
        headers: { cookie: headers.cookie },
      })
      const openedText = await openedRes.text()
      assert.equal(openedRes.status, 200, openedText)
      const opened = JSON.parse(openedText) as { report: { reportId: string } }
      assert.equal(opened.report.reportId, created.report.reportId)
      const generated = (await queryAudit({ action: 'access-review.generate', limit: 100 })).events
      const read = (await queryAudit({ action: 'access-review.read', limit: 100 })).events
      assert.equal(generated.some((e) => e.message === 'Generated access review report for 2026-Q3'), true)
      assert.equal(read.some((e) => e.message === 'Opened access review report for 2026-Q3'), true)
    })
  })

  describe('POST /auth/admin/recovery-token/request', () => {
    it('registers the route', async () => {
      const app = new Hono()
      registerAccessReviewRoutes(app, { audit: async () => {} })
      
      const res = await app.request('/auth/admin/recovery-token/request', {
        method: 'POST',
      })
      
      assert.equal(res.status, 401)
    })
  })

  describe('POST /auth/admin/recovery-token/approve', () => {
    it('registers the route', async () => {
      const app = new Hono()
      registerAccessReviewRoutes(app, { audit: async () => {} })
      
      const res = await app.request('/auth/admin/recovery-token/approve', {
        method: 'POST',
      })
      
      assert.equal(res.status, 401)
    })
  })

  describe('GET /auth/admin/recovery-token/pending', () => {
    it('registers the route', async () => {
      const app = new Hono()
      registerAccessReviewRoutes(app, { audit: async () => {} })
      
      const res = await app.request('/auth/admin/recovery-token/pending', {
        method: 'GET',
      })
      
      assert.equal(res.status, 401)
    })
  })
})
