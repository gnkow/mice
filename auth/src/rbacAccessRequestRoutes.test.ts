import './db/testSchema.js'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-rbac-ar-'))
process.env.SESSION_SECRET = 'test-session-secret-for-rbac-ar'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const { Hono } = await import('hono')
const { registerMeRoutes } = await import('./authentication/session/meRoutes.js')
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
    await openLedger({ ...immudbConfig(), prefix: `rbac-ar/${randomBytes(4).toString('hex')}/` }),
  ),
)

const audited: string[] = []
const app = new Hono()
const audit = async (_c: unknown, _u: unknown, _v: unknown, f: { action: string }) => {
  audited.push(f.action)
}
registerMeRoutes(app, { audit })

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

const json = { 'content-type': 'application/json' }

const signed = async (
  sub: string,
  mutation: { method: string; path: string; body: unknown; reason?: string },
) => ({
  ...(await cookie(sub)),
  ...(await regulatedMutationHeaders(person(sub), mutation)),
})

describe('RBAC S29 Access-request routes', () => {
  it('submits a role request and lists it for a manager', async () => {
    const applicant = 'ar-applicant'
    const manager = 'ar-manager'
    await ensurePrincipal(person(manager))
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

    const submit = await app.request('/auth/access-requests', {
      method: 'POST',
      headers: { ...(await cookie(applicant)), ...json },
      body: JSON.stringify({ message: 'need user access', requestedRole: 'user' }),
    })
    assert.equal(submit.status, 200)
    const submitted = (await submit.json()) as {
      ok: boolean
      request: { id: string; requestedRole: string; status: string }
    }
    assert.equal(submitted.ok, true)
    assert.equal(submitted.request.requestedRole, 'user')
    assert.equal(submitted.request.status, 'pending')
    assert.ok(audited.includes('access-request.submit'))

    const list = await app.request('/auth/access-requests', {
      headers: await cookie(manager),
    })
    assert.equal(list.status, 200)
    const listed = (await list.json()) as {
      requests: Array<{ id: string; requestedRole: string | null }>
    }
    assert.ok(listed.requests.some((r) => r.id === submitted.request.id))
  })

  it('approves with expiry and denies with reason', async () => {
    const manager = 'ar-mgr2'
    const applicant = 'ar-applicant2'
    await ensurePrincipal(person(manager))
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

    const submit = await app.request('/auth/access-requests', {
      method: 'POST',
      headers: { ...(await cookie(applicant)), ...json },
      body: JSON.stringify({ message: 'please', requestedRole: 'user' }),
    })
    assert.equal(submit.status, 200)
    const { request } = (await submit.json()) as { request: { id: string } }
    const path = `/auth/access-requests/${request.id}`

    const missingBody = { action: 'approve' }
    const missingExpiry = await app.request(path, {
      method: 'POST',
      headers: await signed(manager, { method: 'POST', path, body: missingBody }),
      body: JSON.stringify(missingBody),
    })
    assert.equal(missingExpiry.status, 400)

    const approveBody = {
      action: 'approve',
      expiresAt: Date.now() + 86_400_000,
    }
    const approve = await app.request(path, {
      method: 'POST',
      headers: await signed(manager, { method: 'POST', path, body: approveBody }),
      body: JSON.stringify(approveBody),
    })
    assert.equal(approve.status, 200)
    const approved = (await approve.json()) as { ok: boolean; request: { status: string } }
    assert.equal(approved.ok, true)
    assert.equal(approved.request.status, 'approved')
    assert.ok(audited.includes('access-request.approve'))

    const submit2 = await app.request('/auth/access-requests', {
      method: 'POST',
      headers: { ...(await cookie('ar-applicant3')), ...json },
      body: JSON.stringify({ message: 'nope', requestedRole: 'external' }),
    })
    assert.equal(submit2.status, 200)
    const { request: req2 } = (await submit2.json()) as { request: { id: string } }
    const path2 = `/auth/access-requests/${req2.id}`

    const denyMissingBody = { action: 'deny' }
    const denyMissing = await app.request(path2, {
      method: 'POST',
      headers: await signed(manager, { method: 'POST', path: path2, body: denyMissingBody }),
      body: JSON.stringify(denyMissingBody),
    })
    assert.equal(denyMissing.status, 400)

    const denyBody = { action: 'deny', reason: 'not yet' }
    const deny = await app.request(path2, {
      method: 'POST',
      headers: await signed(manager, { method: 'POST', path: path2, body: denyBody }),
      body: JSON.stringify(denyBody),
    })
    assert.equal(deny.status, 200)
    const denied = (await deny.json()) as { request: { status: string } }
    assert.equal(denied.request.status, 'denied')
    assert.ok(audited.includes('access-request.deny'))
  })

  it('forbids non-reviewers from listing and reviewing', async () => {
    const user = 'ar-plain-user'
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
    assert.equal(
      (await app.request('/auth/access-requests', { headers: await cookie(user) })).status,
      403,
    )
  })

  it('approves a modified role and permissions bundle', async () => {
    const manager = 'ar-mgr-modify'
    const applicant = 'ar-applicant-modify'
    await ensurePrincipal(person(manager))
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

    const submit = await app.request('/auth/access-requests', {
      method: 'POST',
      headers: { ...(await cookie(applicant)), ...json },
      body: JSON.stringify({ message: 'want manager', requestedRole: 'manager' }),
    })
    assert.equal(submit.status, 200)
    const { request } = (await submit.json()) as { request: { id: string } }
    const path = `/auth/access-requests/${request.id}`

    const approveBody = {
      action: 'approve',
      expiresAt: Date.now() + 86_400_000,
      grantedRole: 'user',
      grantedPermissions: ['namespace:create'],
      reason: 'subset',
    }
    const approve = await app.request(path, {
      method: 'POST',
      headers: await signed(manager, { method: 'POST', path, body: approveBody }),
      body: JSON.stringify(approveBody),
    })
    assert.equal(approve.status, 200)
    const body = (await approve.json()) as {
      ok: boolean
      request: { status: string; grantedRole?: string | null; grantedPermissions?: string[] }
    }
    assert.equal(body.ok, true)
    assert.equal(body.request.status, 'approved')
    assert.equal(await getUserRole(person(applicant)), 'user')
    assert.ok((await getCustomPermissions(person(applicant))).includes('namespace:create'))
  })
})
