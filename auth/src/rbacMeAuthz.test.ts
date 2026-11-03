import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-rbac-me-'))
process.env.SESSION_SECRET = 'test-session-secret-for-rbac-me'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const { Hono } = await import('hono')
const { registerMeRoutes } = await import('./authentication/session/meRoutes.js')
const { sealSession, ensurePrincipal } = await import('./authentication/session/session.js')
const { sealSessionCookie } = await import('./authentication/session/cookieSeal.js')
const { ensureBootstrapKey } = await import('./authentication/session/sealKeys.js')
const { assignRole, grantCustomPermissions } = await import('./rbacStore.js')
const { INSTANCE_PERMISSION_CATALOG } = await import('./rbacCatalog.js')
const { parseAuthzMe } = await import('./authzContract.js')
const { env, overrideEnv } = await import('./env.js')
overrideEnv({
  directoryProvider: 'keycloak',
  keycloakAdminUrl: 'http://localhost:8180',
  keycloakRealm: 'mice',
  oidcClientId: 'mice-auth',
  oidcClientSecret: 'mice-auth-secret',
  oidcIssuerPublic: 'http://localhost:8180/realms/mice',
})
const { setDirectoryFetchForTests } = await import('./authentication/directory/directory.js')
setDirectoryFetchForTests(async (url) => {
  if (String(url).includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
})

await ensureBootstrapKey()

const app = new Hono()
registerMeRoutes(app, { audit: async () => {} })

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  emailVerified: true as const,
  name: sub,
})

const cookie = async (sub: string) => {
  const u = person(sub)
  await ensurePrincipal(u)
  const sessionId = await sealSession({ ...u, sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return { cookie: `${env.cookieName}=${await sealSessionCookie(sessionId)}` }
}

describe('RBAC S31 GET /auth/me/authz', () => {
  it('returns role, effective permissions, pending, and the RBAC catalog', async () => {
    const pendingRes = await app.request('/auth/me/authz', { headers: await cookie('me-pending') })
    assert.equal(pendingRes.status, 200)
    const pendingBody = parseAuthzMe(await pendingRes.json())
    assert.ok(pendingBody)
    assert.equal(pendingBody!.pending, true)
    assert.equal(pendingBody!.role, null)
    assert.deepEqual(pendingBody!.effectivePermissions, [])
    assert.deepEqual(pendingBody!.permissionCatalog, [...INSTANCE_PERMISSION_CATALOG])
    assert.equal('permissions' in pendingBody!, false)
    assert.equal('instanceAdmin' in pendingBody!, false)
    assert.equal('hasAnyGrant' in pendingBody!, false)

    const user = person('me-user')
    await ensurePrincipal(user)
    assert.equal(
      (await assignRole({
        actor: null,
        target: user,
        role: 'user',
        reason: 'boot',
        bootstrap: true,
      })).ok,
      true,
    )
    assert.equal(
      (
        await grantCustomPermissions({
          actor: null,
          target: user,
          permissions: ['namespace:create'],
          reason: 'boot',
          bootstrap: true,
        })
      ).ok,
      true,
    )

    const res = await app.request('/auth/me/authz', { headers: await cookie('me-user') })
    assert.equal(res.status, 200)
    const body = parseAuthzMe(await res.json())
    assert.ok(body)
    assert.equal(body!.pending, false)
    assert.equal(body!.role, 'user')
    assert.ok(body!.effectivePermissions.includes('repo:files:write'))
    assert.ok(body!.effectivePermissions.includes('namespace:create'))
    assert.equal(body!.permissionCatalog.length, INSTANCE_PERMISSION_CATALOG.length)
  })
})
