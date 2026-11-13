import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, before } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-release-manifest-routes-'))
process.env.SESSION_SECRET = 'test-session-secret-for-release-manifest'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@release-manifest.test'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const { Hono } = await import('hono')
const { registerReleaseManifestRoutes } = await import('./releaseManifestRoutes.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { auditMutation } = await import('./auditMutation.js')
const { initAudit, useAuditLedger } = await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const {
  resetReleaseManifestStatus,
  verifyReleaseManifestAt,
  liveReleaseComponents,
  signReleaseManifest,
  RELEASE_MANIFEST_PUBLIC_KEY_PEM,
} = await import('./releaseManifest.js')
const { writeFileSync } = await import('node:fs')
const { generateKeyPairSync } = await import('node:crypto')
const { sealedSessionCookie } = await import('./testSupport.js')

const admin = {
  sub: 'admin',
  iss: 'https://idp.test',
  email: 'admin@release-manifest.test',
  name: 'Admin',
  emailVerified: true as const,
}

await maybeBootstrapInstanceAdmin(admin)
useAuditLedger(await openLedger(immudbConfig()))
await initAudit()

async function sessionHeaders() {
  return { cookie: await sealedSessionCookie(admin), origin: 'http://localhost' }
}

describe('release manifest admin routes', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  before(async () => {
    resetReleaseManifestStatus()
    const live = liveReleaseComponents()
    const body = {
      format: 'mice-release-manifest/1' as const,
      releaseVersion: '0.0.0',
      components: live,
    }
    const dir = mkdtempSync(join(tmpdir(), 'mice-release-routes-'))
    const path = join(dir, 'release-manifest.json')
    writeFileSync(path, JSON.stringify({ ...body, signature: signReleaseManifest(body, privatePem) }))
    await verifyReleaseManifestAt({ path, publicKeyPem: publicPem })
  })

  it('rejects unauthenticated status', async () => {
    const app = new Hono()
    registerReleaseManifestRoutes(app, { audit: auditMutation })
    assert.equal((await app.request('/auth/admin/release-manifest/status')).status, 401)
  })

  it('returns the last verification for an admin', async () => {
    const app = new Hono()
    registerReleaseManifestRoutes(app, { audit: auditMutation })
    const res = await app.request('/auth/admin/release-manifest/status', {
      headers: await sessionHeaders(),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      present: boolean
      signatureValid: boolean
      match: boolean
      releaseVersion: string
    }
    assert.equal(body.present, true)
    assert.equal(body.signatureValid, true)
    assert.equal(body.match, true)
    assert.equal(body.releaseVersion, '0.0.0')
    void RELEASE_MANIFEST_PUBLIC_KEY_PEM
  })
})
