import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'

/**
 * Ticket 28 route integration: admin mice-suspension HTTP seam
 * (set / lift / history) with regulated mutation headers.
 */

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-suspension-api-'))
process.env.SESSION_SECRET = 'test-session-secret-for-suspension-api'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { registerMiceSuspensionRoutes } = await import('./miceSuspensionRoutes.js')
const { authenticate } = await import('../session/requireAuth.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { regulatedMutationHeaders } = await import('../../testSupport.js')
const { openSignatureStore, useSignatureStore } = await import('../signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('../../auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `esign-mice-susp/${randomBytes(4).toString('hex')}/` }),
  ),
)

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

const mk = (sub: string) => ({
  sub,
  iss: 'idp',
  email: `${sub}@test.com`,
  name: sub,
})

const admin = { ...mk('admin1'), emailVerified: true }
await maybeBootstrapInstanceAdmin(admin)
await ensureBootstrapKey()

const cookie = async (user: ReturnType<typeof mk>) => {
  const sessionId = await sealSession({ ...user, sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

async function signedAdmin(path: string, body: Record<string, unknown>, reason = 'Investigation hold') {
  return {
    cookie: await cookie(admin),
    ...(await regulatedMutationHeaders(admin, {
      method: 'POST',
      path,
      body,
      reason,
      category: 'privileged_settings',
    })),
  }
}

function app() {
  const api = new Hono()
  registerMiceSuspensionRoutes(api, { audit: async () => {} })
  api.get('/x', async (c) => {
    const result = await authenticate(c)
    return result.ok ? c.json({ sub: result.user.sub }) : c.json({ error: result.error }, result.status)
  })
  return api
}

after(() => {
  /* schema cleanup via process exit / testSchema */
})

describe('mice-suspension routes (Ticket 28)', () => {
  it('set → history → lift → history over HTTP', async () => {
    const target = mk(`api-${Date.now().toString(36)}`)
    await cookie(target)
    const api = app()
    const principal = `idp|${target.sub}`

    const setBody = { principal, reason: 'Investigation hold' }
    const set = await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', setBody),
      body: JSON.stringify(setBody),
    })
    assert.equal(set.status, 200, await set.text())

    const afterSet = await api.request(`/auth/admin/mice-suspension?principal=${encodeURIComponent(principal)}`, {
      headers: { cookie: await cookie(admin) },
    })
    assert.equal(afterSet.status, 200, await afterSet.clone().text())
    const setHistory = (await afterSet.json()) as {
      history: Array<{ flag: string; action: string; reason: string; actor: string }>
    }
    assert.deepEqual(setHistory.history.map((r) => ({ flag: r.flag, action: r.action, reason: r.reason, actor: r.actor })), [
      { flag: 'suspended', action: 'set', reason: 'Investigation hold', actor: 'idp|admin1' },
    ])

    const refused = await api.request('/x', { headers: { cookie: await cookie(target) } })
    assert.equal(refused.status, 403)
    assert.equal((await refused.json()).error, 'Suspended')

    const liftBody = { principal, reason: 'Investigation closed' }
    const lift = await api.request('/auth/admin/mice-suspension/lift', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension/lift', liftBody, 'Investigation closed'),
      body: JSON.stringify(liftBody),
    })
    assert.equal(lift.status, 200, await lift.text())

    const afterLift = await api.request(`/auth/admin/mice-suspension?principal=${encodeURIComponent(principal)}`, {
      headers: { cookie: await cookie(admin) },
    })
    assert.equal(afterLift.status, 200)
    const liftHistory = (await afterLift.json()) as {
      history: Array<{ action: string; reason: string }>
    }
    assert.deepEqual(
      liftHistory.history.map((r) => ({ action: r.action, reason: r.reason })),
      [
        { action: 'set', reason: 'Investigation hold' },
        { action: 'lift', reason: 'Investigation closed' },
      ],
    )

    const ok = await api.request('/x', { headers: { cookie: await cookie(target) } })
    assert.equal(ok.status, 200)
  })

  it('returns 404 when the principal does not exist', async () => {
    const api = app()
    const body = { principal: 'idp|no-such-principal', reason: 'Investigation hold' }
    const set = await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', body),
      body: JSON.stringify(body),
    })
    assert.equal(set.status, 404)
  })

  it('returns 400 for an invalid principal format', async () => {
    const api = app()
    const body = { principal: 'not-a-principal', reason: 'Investigation hold' }
    const set = await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', body),
      body: JSON.stringify(body),
    })
    assert.equal(set.status, 400)
  })
})
