import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-service-caller-'))
process.env.SESSION_SECRET = 'test-session-secret-for-service-caller'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { authenticate } = await import('./requireAuth.js')
const { sealSession } = await import('./session.js')
const { sealSessionCookie } = await import('./cookieSeal.js')
const { ensureBootstrapKey } = await import('./sealKeys.js')
const { env } = await import('../../env.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')

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

const cookie = async (user: { sub: string; iss: string; email: string; name: string }) => {
  const sessionId = await sealSession({ ...user, sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

describe('authenticate', () => {
  it('refuses a caller whose issuer is urn:mice:service', async () => {
    await ensureBootstrapKey()
    const app = new Hono()
    app.get('/x', async (c) => {
      const r = await authenticate(c, {})
      return r.ok ? c.json({ sub: r.user.sub }) : c.json({ error: r.error }, r.status)
    })
    const human = await app.request('/x', {
      headers: { cookie: await cookie({ sub: 'ada', iss: 'https://idp.example', email: 'ada@x.io', name: 'Ada' }) },
    })
    assert.equal(human.status, 200)
    const service = await app.request('/x', {
      headers: { cookie: await cookie({ sub: 'sp-1', iss: 'urn:mice:service', email: '', name: 'ci' }) },
    })
    assert.equal(service.status, 401)
  })

  it('refuses a bearer credential whose issuer is urn:mice:service', async () => {
    const { issueCliCredential } = await import('../credentials/cliCredentials.js')
    const { accessToken } = await issueCliCredential({ sub: 'sp-1', iss: 'urn:mice:service', email: '', name: 'ci' })
    const app = new Hono()
    app.get('/x', async (c) => {
      const r = await authenticate(c, {})
      return r.ok ? c.json({ sub: r.user.sub }) : c.json({ error: r.error }, r.status)
    })
    const res = await app.request('/x', { headers: { authorization: `Bearer ${accessToken}` } })
    assert.equal(res.status, 401)
  })
})
