import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth, regulatedMutationHeaders } from '../src/packages/shared/lib/testSupport.js'

/**
 * GxP ticket 03 — revocation-class BFF routes must refuse without free text
 * and accept past the reason/signature gate with ceremony headers.
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerAdminRevocationRoutes } = await import('../src/packages/authentication/lib/access/adminRevocationRoutes.js')
const { registerRevocationRoutes } = await import('../src/packages/authentication/lib/credentials/revocationRoutes.js')
const { preparePrincipal } = await import('../src/packages/authz/lib/authz.js')
const { sealedSessionCookie } = await import('../src/packages/shared/lib/testSupport.js')
const { openSignatureStore, useSignatureStore } = await import('../src/packages/authentication/lib/signing/signatureStore.js')
const { immudbConfig, openLedger } = await import('../src/packages/audit/lib/auditLedger.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `esign-rev/${randomBytes(4).toString('hex')}/` }),
  ),
)

const admin = t.person('root')
await preparePrincipal(admin)
await t.grantRole(admin, 'admin')

const app = new Hono()
registerAdminRevocationRoutes(app, { audit: async () => {} })
registerRevocationRoutes(app)

const cookie = async () =>
  sealedSessionCookie({ ...admin, sessionStart: Math.floor(Date.now() / 1000) })

describe('revocation reason policy (HTTP)', () => {
  it('GXP-R-013 POST /auth/admin/revoke refuses without free text and accepts with ceremony', async () => {
    const path = '/auth/admin/revoke'
    const body = { principal: 'idp|victim', reason: 'Security incident cut-off' }

    const bare = await app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
      },
      body: JSON.stringify(body),
    })
    assert.equal(bare.status, 400)
    assert.equal(((await bare.json()) as { code?: string }).code, 'reason_required')

    const headers = await regulatedMutationHeaders(admin, {
      method: 'POST',
      path,
      body,
      reason: 'Security incident cut-off for compromised credentials',
    })
    const ok = await app.request(path, {
      method: 'POST',
      headers: { ...headers, cookie: await cookie() },
      body: JSON.stringify(body),
    })
    const okJson = (await ok.json().catch(() => ({}))) as { code?: string }
    assert.notEqual(okJson.code, 'reason_required')
    assert.notEqual(okJson.code, 'signature_required')
  })

  it('GXP-R-013 POST /auth/instance/revoke-sessions refuses without a reason and accepts past the gate', async () => {
    const path = '/auth/instance/revoke-sessions'
    const body = { sub: 'victim', iss: 'idp' }

    const bare = await app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await cookie(),
      },
      body: JSON.stringify(body),
    })
    assert.equal(bare.status, 400)
    assert.equal(((await bare.json()) as { code?: string }).code, 'reason_required')

    const headers = await regulatedMutationHeaders(admin, {
      method: 'POST',
      path,
      body,
      reason: 'Offboard sessions after role removal',
    })
    const ok = await app.request(path, {
      method: 'POST',
      headers: { ...headers, cookie: await cookie() },
      body: JSON.stringify(body),
    })
    const okJson = (await ok.json().catch(() => ({}))) as { code?: string }
    assert.notEqual(okJson.code, 'reason_required')
    assert.notEqual(okJson.code, 'signature_required')
  })
})
