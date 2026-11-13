import './db/testSchema.js'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-rbac-grant-'))
process.env.SESSION_SECRET = 'test-session-secret-for-rbac-grant'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const { Hono } = await import('hono')
const { registerRbacGrantRoutes } = await import('./rbacGrantRoutes.js')
const { sealSession, ensurePrincipal } = await import('./authentication/session/session.js')
const { sealSessionCookie } = await import('./authentication/session/cookieSeal.js')
const { ensureBootstrapKey } = await import('./authentication/session/sealKeys.js')
const { assignRole, getCustomPermissions, getUserRole } = await import('./rbacStore.js')
const { env, overrideEnv } = await import('./env.js')
const { regulatedMutationHeaders } = await import('./testSupport.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

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
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
})

await ensureBootstrapKey()
useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `rbac-grant/${randomBytes(4).toString('hex')}/` }),
  ),
)

const audited: string[] = []
const app = new Hono()
registerRbacGrantRoutes(app, {
  audit: async (_c, _u, _v, f) => {
    audited.push(f.action)
  },
})

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

const signed = async (
  sub: string,
  mutation: { method: string; path: string; body: unknown; reason?: string },
) => ({
  ...(await cookie(sub)),
  ...(await regulatedMutationHeaders(person(sub), mutation)),
})

describe('RBAC S30 Direct-grant routes', () => {
  it('lets a manager grant a role with expiry', async () => {
    const manager = 'grant-mgr'
    const target = 'grant-target'
    await ensurePrincipal(person(manager))
    await ensurePrincipal(person(target))
    assert.equal(
      (await assignRole({
        actor: null,
        target: person(manager),
        role: 'manager',
        reason: 'boot',
        bootstrap: true,
      })).ok,
      true,
    )

    const missingBody = { sub: target, iss: 'https://idp.test', role: 'user' }
    const missing = await app.request('/auth/grants/role', {
      method: 'POST',
      headers: await signed(manager, {
        method: 'POST',
        path: '/auth/grants/role',
        body: missingBody,
      }),
      body: JSON.stringify(missingBody),
    })
    assert.equal(missing.status, 400)

    const okBody = {
      sub: target,
      iss: 'https://idp.test',
      role: 'user',
      expiresAt: Date.now() + 86_400_000,
      reason: 'onboard',
    }
    const ok = await app.request('/auth/grants/role', {
      method: 'POST',
      headers: await signed(manager, {
        method: 'POST',
        path: '/auth/grants/role',
        body: okBody,
      }),
      body: JSON.stringify(okBody),
    })
    assert.equal(ok.status, 200)
    assert.equal(await getUserRole(person(target)), 'user')
    assert.ok(audited.includes('role.assign') || audited.includes('access.grant.role'))
  })

  it('lets a manager grant custom permissions with expiry', async () => {
    const manager = 'grant-mgr-perm'
    const target = 'grant-target-perm'
    await ensurePrincipal(person(manager))
    await ensurePrincipal(person(target))
    assert.equal(
      (await assignRole({
        actor: null,
        target: person(manager),
        role: 'manager',
        reason: 'boot',
        bootstrap: true,
      })).ok,
      true,
    )
    assert.equal(
      (await assignRole({
        actor: null,
        target: person(target),
        role: 'user',
        reason: 'boot',
        bootstrap: true,
      })).ok,
      true,
    )

    const okBody = {
      sub: target,
      iss: 'https://idp.test',
      permissions: ['namespace:create'],
      expiresAt: Date.now() + 86_400_000,
      reason: 'temp create',
    }
    const ok = await app.request('/auth/grants/permissions', {
      method: 'POST',
      headers: await signed(manager, {
        method: 'POST',
        path: '/auth/grants/permissions',
        body: okBody,
      }),
      body: JSON.stringify(okBody),
    })
    assert.equal(ok.status, 200)
    assert.ok((await getCustomPermissions(person(target))).includes('namespace:create'))
  })

  it('forbids users without grant authority', async () => {
    const user = 'grant-plain'
    await ensurePrincipal(person(user))
    assert.equal(
      (await assignRole({
        actor: null,
        target: person(user),
        role: 'user',
        reason: 'boot',
        bootstrap: true,
      })).ok,
      true,
    )
    const deniedBody = {
      sub: 'someone',
      iss: 'https://idp.test',
      role: 'external',
      expiresAt: Date.now() + 86_400_000,
    }
    const denied = await app.request('/auth/grants/role', {
      method: 'POST',
      headers: {
        ...(await cookie(user)),
        'content-type': 'application/json',
        'x-mice-reason': 'Routine test change',
        'x-mice-reason-category': 'privileged_settings',
      },
      body: JSON.stringify(deniedBody),
    })
    assert.equal(denied.status, 403)
  })
})
