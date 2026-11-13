/**
 * Route integration for disabled-signer admin list (Ticket 11).
 */

import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-disabled-signers-'))
process.env.SESSION_SECRET = 'test-session-secret-for-disabled-signers'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { registerDisabledSignerRoutes } = await import('./disabledSignerRoutes.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env, overrideEnv } = await import('../../env.js')
const { getDb } = await import('../../db/database.js')
const { principals } = await import('../../db/schema.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')

function directoryFetch(disabled: (url: string) => boolean) {
  return async (url: string) => {
    if (url.includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 300 }), { status: 200 })
    }
    if (url.includes('/users/') && disabled(url)) {
      return new Response(JSON.stringify({ enabled: false, firstName: 'Disabled', lastName: 'User' }), {
        status: 200,
      })
    }
    if (url.includes('/users/')) {
      return new Response(JSON.stringify({ enabled: true, firstName: 'Enabled', lastName: 'User' }), {
        status: 200,
      })
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

const admin = {
  sub: 'admin1',
  iss: 'idp',
  email: 'admin1@test.com',
  name: 'Ada Lovelace',
  emailVerified: true as const,
}
await maybeBootstrapInstanceAdmin(admin)
await ensureBootstrapKey()

const cookie = async () => {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = await sealSession({ ...admin, sessionStart: now - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

describe('GET /auth/admin/disabled-signers', () => {
  beforeEach(() => {
    overrideEnv({
      directoryProvider: 'keycloak',
      keycloakAdminUrl: 'http://directory.test',
      keycloakRealm: 'mice',
      oidcClientId: 'mice-auth',
      oidcClientSecret: 'test-secret',
    })
    setDirectoryFetchForTests(directoryFetch((url) => url.includes('/users/disabled-user')))
  })

  it('rejects unauthenticated callers', async () => {
    const app = new Hono()
    registerDisabledSignerRoutes(app)
    const res = await app.request('/auth/admin/disabled-signers')
    assert.equal(res.status, 401)
  })

  it('returns critical alarms for IdP-disabled Principals with signing rights', async () => {
    await getDb().insert(principals).values({
      sub: 'disabled-user',
      iss: 'http://localhost:8180/realms/mice',
      createdAt: new Date(),
      name: 'Disabled User',
    })

    const app = new Hono()
    registerDisabledSignerRoutes(app)
    const res = await app.request('/auth/admin/disabled-signers', {
      headers: { cookie: await cookie() },
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text) as {
      alarms: Array<{ sub: string; severity: string; reason: string }>
    }
    const hit = body.alarms.find((a) => a.sub === 'disabled-user')
    assert.ok(hit)
    assert.equal(hit.severity, 'critical')
    assert.match(hit.reason, /disabled in IdP/)
  })

  it('omits IdP-enabled Principals from the alarm list', async () => {
    await getDb().insert(principals).values({
      sub: 'enabled-only-user',
      iss: 'http://localhost:8180/realms/mice',
      createdAt: new Date(),
      name: 'Enabled User',
    })

    const app = new Hono()
    registerDisabledSignerRoutes(app)
    const res = await app.request('/auth/admin/disabled-signers', {
      headers: { cookie: await cookie() },
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text) as { alarms: Array<{ sub: string }> }
    assert.equal(body.alarms.some((a) => a.sub === 'enabled-only-user'), false)
  })

  it('uses an injected check port when provided', async () => {
    const app = new Hono()
    registerDisabledSignerRoutes(app, {
      check: async () => [
        {
          principalId: 42,
          sub: 'injected',
          iss: 'idp',
          name: 'Injected',
          severity: 'critical',
          reason: 'Principal is disabled in IdP but still has signing rights in Mice',
        },
      ],
    })
    const res = await app.request('/auth/admin/disabled-signers', {
      headers: { cookie: await cookie() },
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text) as { alarms: Array<{ sub: string }> }
    assert.equal(body.alarms.length, 1)
    assert.equal(body.alarms[0].sub, 'injected')
  })
})
