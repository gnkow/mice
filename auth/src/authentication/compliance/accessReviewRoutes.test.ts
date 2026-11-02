import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
const { startAccessReviewAlertSchedule } = await import('./accessReviewAlert.js')
const { useNovu } = await import('../../novu.js')
const { subscriberId } = await import('../../notifications.js')
const { notificationUserKey } = await import('../../notificationsStore.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { getDb } = await import('../../db/database.js')
const { accessReviewReports, principals } = await import('../../db/schema.js')
const { eq } = await import('drizzle-orm')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { queryAudit } = await import('../../audit.js')

// Mock IdP to always return enabled
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

const idToken = () => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none', kid: 'test-key' })}.${part({ acr: 'mfa', amr: ['pwd', 'otp'], iss: 'idp' })}.sig`
}

const freshCookie = async (user: ReturnType<typeof mk>) => {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = await sealSession({
    ...user,
    sessionStart: now - 30,
    authTime: now,
    lastActive: now,
    idToken: idToken(),
  })
  const sealed = await sealSessionCookie(sessionId)
  return `${env.cookieName}=${sealed}`
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

function displayedHash(report: { reviewerSignature?: unknown }) {
  const displayed = { ...report }
  delete displayed.reviewerSignature
  return createHash('sha256').update(JSON.stringify(sorted(displayed))).digest('hex')
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

  it('an instance admin signs the stored report they were shown', async () => {
    await ensureBootstrapKey()
    const app = new Hono()
    registerAccessReviewRoutes(app, { audit: async () => {} })
    const headers = { cookie: await freshCookie(admin), ...json }
    const createdText = await (
      await app.request('/auth/admin/access-review/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ quarter: '2026-Q4' }),
      })
    ).text()
    const created = JSON.parse(createdText) as { report: { reportId: string; reviewerSignature?: { hash: string } } }
    const expectedHash = displayedHash(created.report)
    const signedRes = await app.request('/auth/admin/access-review/sign', {
      method: 'POST',
      headers,
      body: JSON.stringify({ quarter: '2026-Q4', expectedHash }),
    })
    const signedText = await signedRes.text()
    assert.equal(signedRes.status, 200, signedText)
    const openedRes = await app.request('/auth/admin/access-review/2026-Q4', { headers: { cookie: headers.cookie } })
    const opened = JSON.parse(await openedRes.text()) as {
      report: { reviewerSignature?: { hash: string; meaning: string; principal: { sub: string } } }
    }
    assert.equal(opened.report.reviewerSignature?.principal.sub, 'admin1')
    assert.equal(opened.report.reviewerSignature?.meaning, 'Reviewed')
    assert.equal(opened.report.reviewerSignature?.hash, expectedHash)
  })

  it('refuses a reviewer who is not an instance admin', async () => {
    await ensureBootstrapKey()
    const app = new Hono()
    registerAccessReviewRoutes(app, { audit: async () => {} })
    const createdText = await (
      await app.request('/auth/admin/access-review/generate', {
        method: 'POST',
        headers: { cookie: await cookie(admin), ...json },
        body: JSON.stringify({ quarter: '2026-Q5' }),
      })
    ).text()
    const created = JSON.parse(createdText) as { report: { reviewerSignature?: unknown } }
    const reader = mk('reader')
    const res = await app.request('/auth/admin/access-review/sign', {
      method: 'POST',
      headers: { cookie: await freshCookie(reader), ...json },
      body: JSON.stringify({ quarter: '2026-Q5', expectedHash: displayedHash(created.report) }),
    })
    const text = await res.text()
    assert.equal(res.status, 403, text)
    assert.match(text, /Admin required/)
    const opened = JSON.parse(await (await app.request('/auth/admin/access-review/2026-Q5', {
      headers: { cookie: await cookie(admin) },
    })).text()) as { report: { reviewerSignature?: unknown } }
    assert.equal(opened.report.reviewerSignature, undefined)
  })

  it('refuses a signature when the stored report changed after it was shown', async () => {
    await ensureBootstrapKey()
    const app = new Hono()
    registerAccessReviewRoutes(app, { audit: async () => {} })
    const headers = { cookie: await freshCookie(admin), ...json }
    const createdText = await (
      await app.request('/auth/admin/access-review/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ quarter: '2027-Q1' }),
      })
    ).text()
    const created = JSON.parse(createdText) as { report: { principals: unknown[] } }
    const shown = displayedHash(created.report)
    await getDb()
      .update(accessReviewReports)
      .set({ report: { ...created.report, principals: [] } })
      .where(eq(accessReviewReports.quarter, '2027-Q1'))
    const res = await app.request('/auth/admin/access-review/sign', {
      method: 'POST',
      headers,
      body: JSON.stringify({ quarter: '2027-Q1', expectedHash: shown }),
    })
    const text = await res.text()
    assert.equal(res.status, 400, text)
    assert.match(text, /changed after display/)
    const opened = JSON.parse(await (await app.request('/auth/admin/access-review/2027-Q1', {
      headers: { cookie: headers.cookie },
    })).text()) as { report: { reviewerSignature?: unknown } }
    assert.equal(opened.report.reviewerSignature, undefined)
  })

  it('audits the reviewer and the report id', async () => {
    await ensureBootstrapKey()
    const app = new Hono()
    registerAccessReviewRoutes(app, { audit: async () => {} })
    const headers = { cookie: await freshCookie(admin), ...json }
    const createdText = await (
      await app.request('/auth/admin/access-review/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ quarter: '2027-Q2' }),
      })
    ).text()
    const created = JSON.parse(createdText) as { report: { reportId: string } }
    const res = await app.request('/auth/admin/access-review/sign', {
      method: 'POST',
      headers,
      body: JSON.stringify({ quarter: '2027-Q2', expectedHash: displayedHash(created.report) }),
    })
    assert.equal(res.status, 200, await res.text())
    const events = (await queryAudit({ action: 'access-review.sign', limit: 20 })).events
    const event = events.find((e) => e.message === `Signed access review ${created.report.reportId}`)
    assert.ok(event)
    assert.equal(event.actor.iss, 'idp')
    assert.equal(event.actor.sub, 'admin1')
    assert.equal(event.detail?.reportId, created.report.reportId)
  })

  it('lists an unsigned access review older than 14 days', async () => {
    await ensureBootstrapKey()
    const app = new Hono()
    registerAccessReviewRoutes(app, { audit: async () => {} })
    await getDb().insert(accessReviewReports).values({
      quarter: '2020-Q1',
      report: {
        reportId: 'access-review-2020-Q1',
        quarter: '2020-Q1',
        generatedAt: Date.UTC(2020, 0, 1),
        principals: [],
      },
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    const headers = { cookie: await cookie(admin), ...json }
    const fresh = await app.request('/auth/admin/access-review/generate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ quarter: '2098-Q1' }),
    })
    assert.equal(fresh.status, 200, await fresh.text())
    const res = await app.request('/auth/admin/access-review/overdue', { headers: { cookie: headers.cookie } })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text) as { overdue: Array<{ quarter: string; reportId: string }> }
    assert.deepEqual(body.overdue, [{ quarter: '2020-Q1', reportId: 'access-review-2020-Q1' }])
  })

  it('does not list a signed access review', async () => {
    await ensureBootstrapKey()
    const app = new Hono()
    registerAccessReviewRoutes(app, { audit: async () => {} })
    await getDb().insert(accessReviewReports).values({
      quarter: '2019-Q4',
      report: {
        reportId: 'access-review-2019-Q4',
        quarter: '2019-Q4',
        generatedAt: Date.UTC(2019, 9, 1),
        principals: [],
        reviewerSignature: {
          hash: 'signed',
          principal: { iss: 'idp', sub: 'admin1', name: 'admin1' },
          signedAt: Date.UTC(2019, 9, 2),
          meaning: 'Reviewed',
          content: '{}',
        },
      },
      createdAt: new Date('2019-10-01T00:00:00.000Z'),
    })
    const res = await app.request('/auth/admin/access-review/overdue', { headers: { cookie: await cookie(admin) } })
    const body = JSON.parse(await res.text()) as { overdue: Array<{ quarter: string }> }
    assert.equal(body.overdue.some((row) => row.quarter === '2019-Q4'), false)
  })

  it('notifies instance admins when an access review is unsigned for 14 days', async () => {
    const triggered: Array<{ subscriberId: string; payload: { summary?: string; title?: string; category?: string } }> = []
    useNovu({
      async trigger(subscriberId, _eventId, payload) {
        triggered.push({ subscriberId, payload: payload as { summary?: string; title?: string; category?: string } })
      },
      async feed() { return [] },
      async mark() {},
      async deleteSubscriber() {},
      async health() { return { ok: true } },
    })
    await getDb().insert(accessReviewReports).values({
      quarter: '2018-Q4',
      report: {
        reportId: 'access-review-2018-Q4',
        quarter: '2018-Q4',
        generatedAt: Date.UTC(2018, 9, 1),
        principals: [],
      },
      createdAt: new Date('2018-10-01T00:00:00.000Z'),
    })
    await getDb().insert(accessReviewReports).values({
      quarter: '2017-Q1',
      report: {
        reportId: 'access-review-2017-Q1',
        quarter: '2017-Q1',
        generatedAt: Date.UTC(2017, 0, 1),
        principals: [],
        reviewerSignature: {
          hash: 'signed',
          principal: { iss: 'idp', sub: 'admin1', name: 'admin1' },
          signedAt: Date.UTC(2017, 0, 2),
          meaning: 'Reviewed',
          content: '{}',
        },
      },
      createdAt: new Date('2017-01-01T00:00:00.000Z'),
    })
    const schedule = startAccessReviewAlertSchedule({ poll: false })
    const sent = await schedule.tick()
    assert.equal(sent, true)
    const adminId = subscriberId(notificationUserKey({ iss: 'idp', sub: 'admin1' }))
    const note = triggered.find((row) => row.subscriberId === adminId && (row.payload.summary ?? '').includes('access-review-2018-Q4'))
    assert.ok(note)
    assert.equal(note.payload.category, 'security')
    assert.equal(note.payload.title, 'Access review unsigned')
    assert.match(note.payload.summary ?? '', /2018-Q4/)
    assert.match(note.payload.summary ?? '', /access-review-2018-Q4/)
    assert.equal(triggered.some((row) => (row.payload.summary ?? '').includes('2017-Q1')), false)
  })

  it('recovery-token routes are gone', async () => {
    const app = new Hono()
    registerAccessReviewRoutes(app, { audit: async () => {} })
    for (const [method, path] of [
      ['POST', '/auth/admin/recovery-token/request'],
      ['POST', '/auth/admin/recovery-token/approve'],
      ['POST', '/auth/admin/recovery-token/validate'],
      ['GET', '/auth/admin/recovery-token/pending'],
    ] as const) {
      const res = await app.request(path, { method })
      assert.equal(res.status, 404, `${method} ${path}`)
    }
  })
})
