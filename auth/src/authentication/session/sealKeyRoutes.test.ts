import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-seal-key-routes-'))
process.env.SESSION_SECRET = 'test-session-secret-for-seal-keys'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@test.io'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://directory.test'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'https://idp.test'

const { Hono } = await import('hono')
const { registerSealKeyRoutes } = await import('./sealKeyRoutes.js')
const { sealSession } = await import('./session.js')
const { sealSessionCookie } = await import('./cookieSeal.js')
const { ensureBootstrapKey, getCurrentSealKey, getSealKeyById } = await import('./sealKeys.js')
const { env } = await import('../../env.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { queryAudit } = await import('../../audit.js')
const { getDb } = await import('../../db/database.js')
const { sealKeys } = await import('../../db/schema.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')

setDirectoryFetchForTests(async (input) => {
  const url = String(input)
  if (url.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }), { status: 200 })
  }
  if (url.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ad', lastName: 'Min' }), {
      status: 200,
    })
  }
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
})

const admin = {
  sub: 'admin',
  iss: 'https://idp.test',
  email: 'admin@test.io',
  name: 'Admin',
  emailVerified: true,
}

await maybeBootstrapInstanceAdmin(admin)

async function adminCookie() {
  const id = await sealSession({
    ...admin,
    sessionStart: Math.floor(Date.now() / 1000) - 30,
  })
  return `${env.cookieName}=${await sealSessionCookie(id)}`
}

function app() {
  const api = new Hono()
  registerSealKeyRoutes(api)
  return api
}

describe('Seal key rotation HTTP seam (Ticket 17)', () => {
  beforeEach(async () => {
    await getDb().delete(sealKeys)
    await ensureBootstrapKey()
  })

  it('POST /auth/admin/seal-keys/rotate performs normal rotation and audits', async () => {
    const api = app()
    const before = await getCurrentSealKey()
    assert.ok(before)

    const res = await api.request('/auth/admin/seal-keys/rotate', {
      method: 'POST',
      headers: {
        cookie: await adminCookie(),
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: '{}',
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text) as {
      success: boolean
      key: { id: string; rotationType: string; validUntil: number | null }
    }
    assert.equal(body.success, true)
    assert.equal(body.key.rotationType, 'normal')
    assert.equal(body.key.validUntil, null)
    assert.notEqual(body.key.id, before!.id)

    const retired = await getSealKeyById(before!.id)
    assert.ok(retired?.validUntil, 'previous key keeps 7-day overlap')

    const { events } = await queryAudit({ action: 'seal_key.rotated', limit: 10 })
    assert.ok(events.some((e) => e.detail?.newKeyId === body.key.id))
  })

  it('POST /auth/admin/seal-keys/rotate/emergency revokes current key with 8h grace and audits', async () => {
    const api = app()
    const before = await getCurrentSealKey()
    assert.ok(before)

    const res = await api.request('/auth/admin/seal-keys/rotate/emergency', {
      method: 'POST',
      headers: {
        cookie: await adminCookie(),
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Compromise suspected in lab' }),
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text) as {
      success: boolean
      oldKey: { id: string; revokedAt: number; gracePeriodUntil: number }
      newKey: { id: string; rotationType: string }
    }
    assert.equal(body.success, true)
    assert.equal(body.oldKey.id, before!.id)
    assert.ok(body.oldKey.revokedAt)
    assert.ok(body.oldKey.gracePeriodUntil)
    assert.equal(body.newKey.rotationType, 'emergency')

    const eightHours = 8 * 60 * 60
    assert.ok(
      Math.abs(body.oldKey.gracePeriodUntil - (body.oldKey.revokedAt + eightHours)) < 5,
      'grace is ~8 hours from revoke',
    )

    const { events } = await queryAudit({ action: 'seal_key.emergency_rotation', limit: 10 })
    assert.ok(
      events.some(
        (e) =>
          e.detail?.oldKeyId === before!.id &&
          e.detail?.newKeyId === body.newKey.id &&
          String(e.message).includes('Compromise suspected'),
      ),
    )
  })

  it('GET /auth/admin/seal-keys lists keys without key material', async () => {
    const api = app()
    const res = await api.request('/auth/admin/seal-keys', {
      headers: { cookie: await adminCookie(), origin: 'http://localhost' },
    })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    const body = JSON.parse(text) as { keys: Array<Record<string, unknown>> }
    assert.ok(body.keys.length >= 1)
    for (const key of body.keys) {
      assert.equal('keyMaterial' in key, false)
      assert.ok(typeof key.id === 'string')
      assert.ok(typeof key.status === 'string')
    }
  })
})
