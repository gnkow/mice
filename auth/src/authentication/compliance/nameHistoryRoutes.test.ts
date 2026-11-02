import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-name-history-'))
process.env.SESSION_SECRET = 'test-session-secret-for-name-history'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { registerNameHistoryRoutes } = await import('./nameHistoryRoutes.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { ensurePrincipal } = await import('../session/session.js')
const { env } = await import('../../env.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { trackNameChange } = await import('../session/nameChangeHistory.js')

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  if (urlStr.includes('/users/admin1')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  throw new Error(`directory asked for ${urlStr}`)
})

const admin = { iss: 'idp', sub: 'admin1', email: 'admin1@test.com', name: 'Ada Lovelace', emailVerified: true }
await maybeBootstrapInstanceAdmin(admin)
await ensureBootstrapKey()

const cookie = async () => {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = await sealSession({ ...admin, sessionStart: now - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

describe('Principal name history', () => {
  it('lists the stored names oldest first and does not ask the IdP', async () => {
    const principalId = await ensurePrincipal({ iss: 'https://idp.example', sub: 'jane', email: 'jane@example.com' })
    await trackNameChange(principalId, 'Dr. Jane Smith', new Date('2021-03-15T00:00:00.000Z'))
    await trackNameChange(principalId, 'Dr. Jane Jones', new Date('2023-06-01T00:00:00.000Z'))
    const app = new Hono()
    registerNameHistoryRoutes(app)
    const params = new URLSearchParams({ iss: 'https://idp.example', sub: 'jane' })
    const res = await app.request(`/auth/admin/principals/names?${params}`, { headers: { cookie: await cookie() } })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    assert.deepEqual(JSON.parse(text), {
      currentName: 'Dr. Jane Jones',
      history: [
        { name: 'Dr. Jane Smith', validFrom: '2021-03-15T00:00:00.000Z', validTo: '2023-06-01T00:00:00.000Z' },
        { name: 'Dr. Jane Jones', validFrom: '2023-06-01T00:00:00.000Z', validTo: null },
      ],
    })
  })
})
