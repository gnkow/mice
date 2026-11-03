import './db/testSchema.js'
import assert from 'node:assert/strict'
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
const { assignRole } = await import('./rbacStore.js')
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
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
})

await ensureBootstrapKey()

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

const json = { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' }

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

    const missingExpiry = await app.request(`/auth/access-requests/${request.id}`, {
      method: 'POST',
      headers: { ...(await cookie(manager)), ...json },
      body: JSON.stringify({ action: 'approve' }),
    })
    assert.equal(missingExpiry.status, 400)

    const approve = await app.request(`/auth/access-requests/${request.id}`, {
      method: 'POST',
      headers: { ...(await cookie(manager)), ...json },
      body: JSON.stringify({
        action: 'approve',
        expiresAt: Date.now() + 86_400_000,
      }),
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

    const denyMissing = await app.request(`/auth/access-requests/${req2.id}`, {
      method: 'POST',
      headers: { ...(await cookie(manager)), ...json },
      body: JSON.stringify({ action: 'deny' }),
    })
    assert.equal(denyMissing.status, 400)

    const deny = await app.request(`/auth/access-requests/${req2.id}`, {
      method: 'POST',
      headers: { ...(await cookie(manager)), ...json },
      body: JSON.stringify({ action: 'deny', reason: 'not yet' }),
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
})
