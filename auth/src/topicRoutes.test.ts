import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-topic-'))
process.env.SESSION_SECRET = 'test-session-secret-for-topic'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { Hono } = await import('hono')
const { registerInstanceRoutes } = await import('./instanceRoutes.js')
const { registerRevocationRoutes } = await import('./authentication/index.js')
const { sealSession } = await import('./authentication/session/session.js')
const { sealSessionCookie } = await import('./authentication/session/cookieSeal.js')
const { ensureBootstrapKey } = await import('./authentication/session/sealKeys.js')
const { issueCliCredential, resolveCliCredential } = await import('./authentication/credentials/cliCredentials.js')
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
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
})

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
const { preparePrincipal } = await import('./authz.js')
const root = { ...mk('root'), emailVerified: true as const }
await preparePrincipal(root)
await ensureBootstrapKey()

const audited: string[] = []
const app = new Hono()
const audit = async (_c: unknown, _u: unknown, _v: unknown, f: { action: string }) => void audited.push(f.action)
registerInstanceRoutes(app, { audit })
registerRevocationRoutes(app)

const cookie = async (sub: string) => {
  const sessionId = await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return { cookie: `${env.cookieName}=${await sealSessionCookie(sessionId)}` }
}
const json = { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' }

await describe('instance routes', async () => {
  await it('refuses non-admins and reports enforcement as on', async () => {
    assert.equal((await app.request('/auth/instance', { headers: await cookie('nobody') })).status, 403)
    const h = await cookie('root')
    const body = (await (await app.request('/auth/instance', { headers: h })).json()) as { enforce: boolean }
    assert.equal(body.enforce, true)
  })

  await it('validates and audits the admin list changes', async () => {
    const h = { ...(await cookie('root')), ...json }
    const bad = await app.request('/auth/instance/admins', { method: 'POST', headers: h, body: '{}' })
    assert.equal(bad.status, 400)
    const denied = await app.request('/auth/instance/admins', { method: 'POST', headers: { ...(await cookie('nobody')), ...json }, body: JSON.stringify({ sub: 'x', iss: 'idp' }) })
    assert.equal(denied.status, 403)
    assert.ok(audited.includes('instance.admin.add'))
  })

  await it('requires expiresAt when setting delegated permissions and returns it on GET', async () => {
    const h = { ...(await cookie('root')), ...json }
    const missing = await app.request('/auth/instance/permissions', {
      method: 'PUT',
      headers: h,
      body: JSON.stringify({ sub: 'delegatee', iss: 'idp', permissions: ['view_audit'] }),
    })
    assert.equal(missing.status, 403)
    const missingBody = (await missing.json()) as { error: string }
    assert.match(missingBody.error, /expir/i)

    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
    const ok = await app.request('/auth/instance/permissions', {
      method: 'PUT',
      headers: h,
      body: JSON.stringify({
        sub: 'delegatee',
        iss: 'idp',
        permissions: ['view_audit'],
        expiresAt,
      }),
    })
    assert.equal(ok.status, 200)

    const listed = (await (await app.request('/auth/instance', { headers: await cookie('root') })).json()) as {
      permissions: Array<{ sub: string; iss: string; permissions: string[]; expiresAt: number }>
    }
    const row = listed.permissions.find((p) => p.sub === 'delegatee' && p.iss === 'idp')
    assert.ok(row)
    assert.deepEqual(row.permissions, ['view_audit'])
    assert.equal(row.expiresAt, expiresAt)
  })
})

await describe('revocation routes', async () => {
  await it('lets an admin cut off a Principal and refuses others', async () => {
    const { accessToken } = await issueCliCredential(mk('victim'))
    const body = JSON.stringify({ sub: 'victim', iss: 'idp' })
    const denied = await app.request('/auth/instance/revoke-sessions', { method: 'POST', headers: { ...(await cookie('nobody')), ...json }, body })
    assert.equal(denied.status, 403)
    assert.ok(await resolveCliCredential(accessToken))
    const ok = await app.request('/auth/instance/revoke-sessions', { method: 'POST', headers: { ...(await cookie('root')), ...json }, body })
    assert.equal(ok.status, 200)
    assert.equal(await resolveCliCredential(accessToken), null)
  })
})
