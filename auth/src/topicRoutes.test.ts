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

const { regulatedMutationHeaders } = await import('./testSupport.js')
const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { randomBytes } = await import('node:crypto')
useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `topic/${randomBytes(4).toString('hex')}/` }),
  ),
)

const cookie = async (sub: string) => {
  const sessionId = await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return { cookie: `${env.cookieName}=${await sealSessionCookie(sessionId)}` }
}
const signed = async (
  sub: string,
  mutation: { method: string; path: string; body?: unknown },
) => ({
  ...(await cookie(sub)),
  ...(await regulatedMutationHeaders(mk(sub), mutation)),
})

await describe('instance routes', async () => {
  await it('refuses non-admins and reports enforcement as on', async () => {
    assert.equal((await app.request('/auth/instance', { headers: await cookie('nobody') })).status, 403)
    const h = await cookie('root')
    const body = (await (await app.request('/auth/instance', { headers: h })).json()) as { enforce: boolean }
    assert.equal(body.enforce, true)
  })

  await it('validates and audits instance permission changes', async () => {
    const badBody = {}
    const bad = await app.request('/auth/instance/permissions', {
      method: 'PUT',
      headers: await signed('root', { method: 'PUT', path: '/auth/instance/permissions', body: badBody }),
      body: '{}',
    })
    assert.equal(bad.status, 400)
    const deniedBody = { sub: 'x', iss: 'idp', permissions: ['view_audit'], expiresAt: Date.now() + 86_400_000 }
    const denied = await app.request('/auth/instance/permissions', {
      method: 'PUT',
      headers: await signed('nobody', { method: 'PUT', path: '/auth/instance/permissions', body: deniedBody }),
      body: JSON.stringify(deniedBody),
    })
    assert.equal(denied.status, 403)
    assert.ok(audited.includes('instance.permissions.update'))
  })

  await it('requires expiresAt when setting delegated permissions and returns it on GET', async () => {
    const missingBody = { sub: 'delegatee', iss: 'idp', permissions: ['view_audit'] }
    const missing = await app.request('/auth/instance/permissions', {
      method: 'PUT',
      headers: await signed('root', { method: 'PUT', path: '/auth/instance/permissions', body: missingBody }),
      body: JSON.stringify(missingBody),
    })
    assert.equal(missing.status, 403)
    const missingJson = (await missing.json()) as { error: string }
    assert.match(missingJson.error, /expir/i)

    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
    const okBody = {
      sub: 'delegatee',
      iss: 'idp',
      permissions: ['view_audit'],
      expiresAt,
    }
    const ok = await app.request('/auth/instance/permissions', {
      method: 'PUT',
      headers: await signed('root', { method: 'PUT', path: '/auth/instance/permissions', body: okBody }),
      body: JSON.stringify(okBody),
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
    const payload = { sub: 'victim', iss: 'idp' }
    const body = JSON.stringify(payload)
    const denied = await app.request('/auth/instance/revoke-sessions', {
      method: 'POST',
      headers: await signed('nobody', {
        method: 'POST',
        path: '/auth/instance/revoke-sessions',
        body: payload,
      }),
      body,
    })
    assert.equal(denied.status, 403)
    assert.ok(await resolveCliCredential(accessToken))
    const ok = await app.request('/auth/instance/revoke-sessions', {
      method: 'POST',
      headers: await signed('root', {
        method: 'POST',
        path: '/auth/instance/revoke-sessions',
        body: payload,
      }),
      body,
    })
    assert.equal(ok.status, 200)
    assert.equal(await resolveCliCredential(accessToken), null)
  })
})
