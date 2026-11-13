/**
 * Route integration for IdP baseline drift admin APIs (Ticket 23).
 */

import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-idp-drift-routes-'))
process.env.SESSION_SECRET = 'test-session-secret-for-idp-drift-routes'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER = 'http://localhost:8180/realms/mice'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { registerIdpDriftRoutes } = await import('./idpDriftRoutes.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env, overrideEnv } = await import('../../env.js')
const { getDb } = await import('../../db/database.js')
const { idpBaseline, idpDriftReports } = await import('../../db/schema.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { establishBaseline } = await import('./idpDriftDetection.js')

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), {
      status: 200,
    })
  }
  throw new Error(`directory asked for ${urlStr}`)
})

const admin = {
  sub: 'admin1',
  iss: 'idp',
  email: 'admin1@test.com',
  name: 'Ada Lovelace',
  emailVerified: true as const,
}
await maybeBootstrapInstanceAdmin(admin)
await ensureBootstrapKey()
overrideEnv({ oidcIssuer: 'http://localhost:8180/realms/mice' })

const cookie = async () => {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = await sealSession({ ...admin, sessionStart: now - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

const discovery = {
  issuer: 'http://localhost:8180/realms/mice',
  scopes_supported: ['openid', 'profile', 'email'],
  id_token_signing_alg_values_supported: ['RS256'],
  claims_supported: ['sub', 'acr', 'amr', 'auth_time'],
}

const driftDeps = {
  fetchDiscovery: async () => discovery,
  issuer: () => discovery.issuer,
}

function app() {
  const api = new Hono()
  registerIdpDriftRoutes(api, driftDeps)
  return api
}

const jsonHeaders = async () => ({
  cookie: await cookie(),
  origin: 'http://localhost',
  'content-type': 'application/json',
})

describe('IdP drift admin routes', () => {
  beforeEach(async () => {
    await getDb().delete(idpDriftReports)
    await getDb().delete(idpBaseline)
  })

  it('rejects unauthenticated baseline and check', async () => {
    const api = app()
    assert.equal((await api.request('/auth/admin/idp-drift/baseline')).status, 401)
    assert.equal(
      (await api.request('/auth/admin/idp-drift/check', { method: 'POST' })).status,
      401,
    )
  })

  it('returns 404 when no baseline is established', async () => {
    const api = app()
    const res = await api.request('/auth/admin/idp-drift/baseline', {
      headers: { cookie: await cookie() },
    })
    assert.equal(res.status, 404)
  })

  it('lets an admin establish, read, compare, check, and list reports', async () => {
    const api = app()
    const body = {
      mfaClaimsAvailable: { amr: ['mfa', 'otp'], authTimeAsserted: true },
      requiredScopes: ['openid', 'profile'],
      signatureAlgorithm: 'RS256',
      groupClaimFormat: 'array',
    }

    const established = await api.request('/auth/admin/idp-drift/baseline', {
      method: 'POST',
      headers: await jsonHeaders(),
      body: JSON.stringify(body),
    })
    const establishedText = await established.text()
    assert.equal(established.status, 200, establishedText)
    const establishedBody = JSON.parse(establishedText) as { baseline: { id: number; isCurrent: boolean } }
    assert.ok(establishedBody.baseline.id)
    assert.equal(establishedBody.baseline.isCurrent, true)

    const got = await api.request('/auth/admin/idp-drift/baseline', {
      headers: { cookie: await cookie() },
    })
    assert.equal(got.status, 200)
    assert.equal((await got.json() as { baseline: { id: number } }).baseline.id, establishedBody.baseline.id)

    const current = await api.request('/auth/admin/idp-drift/current', {
      headers: { cookie: await cookie() },
    })
    assert.equal(current.status, 200)
    assert.equal(
      (await current.json() as { current: { issuer: string } }).current.issuer,
      discovery.issuer,
    )

    const compare = await api.request('/auth/admin/idp-drift/compare', {
      headers: { cookie: await cookie() },
    })
    const compareText = await compare.text()
    assert.equal(compare.status, 200, compareText)
    const compareBody = JSON.parse(compareText) as {
      hasCriticalDrift: boolean
      criticalDrifts: string[]
    }
    // Baseline MFA claims are not present on discovery-derived current config → critical.
    assert.equal(compareBody.hasCriticalDrift, true)
    assert.ok(compareBody.criticalDrifts.some((d) => d.includes('MFA')))

    const beforeReports = await getDb().select().from(idpDriftReports)
    assert.equal(beforeReports.length, 0)

    const checked = await api.request('/auth/admin/idp-drift/check', {
      method: 'POST',
      headers: await jsonHeaders(),
      body: '{}',
    })
    const checkedText = await checked.text()
    assert.equal(checked.status, 200, checkedText)
    const checkedBody = JSON.parse(checkedText) as {
      report: { id: number; hasCriticalDrift: boolean }
    }
    assert.ok(checkedBody.report.id)
    assert.equal(checkedBody.report.hasCriticalDrift, true)

    const reports = await api.request('/auth/admin/idp-drift/reports', {
      headers: { cookie: await cookie() },
    })
    assert.equal(reports.status, 200)
    const reportBody = await reports.json() as { reports: Array<{ id: number }> }
    assert.equal(reportBody.reports.length, 1)
    assert.equal(reportBody.reports[0].id, checkedBody.report.id)
  })

  it('compare does not persist a report', async () => {
    await establishBaseline('admin1@test.com', {
      mfaClaimsAvailable: { amr: ['mfa'] },
      requiredScopes: ['openid'],
      signatureAlgorithm: 'RS256',
      groupClaimFormat: 'array',
    })
    const api = app()
    const compare = await api.request('/auth/admin/idp-drift/compare', {
      headers: { cookie: await cookie() },
    })
    assert.equal(compare.status, 200)
    const rows = await getDb().select().from(idpDriftReports)
    assert.equal(rows.length, 0)
  })
})
