import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, before } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-regulated-config-routes-'))
process.env.SESSION_SECRET = 'test-session-secret-for-regulated-config'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@regulated-config.test'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const { Hono } = await import('hono')
const { registerRegulatedConfigRoutes } = await import('./regulatedConfigRoutes.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { auditMutation } = await import('./auditMutation.js')
const { initAudit, useAuditLedger } = await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { recordRegulatedConfigAtStart, resetRegulatedConfigStatus } = await import('./regulatedConfig.js')
const { sealedSessionCookie } = await import('./testSupport.js')

const admin = {
  sub: 'admin',
  iss: 'https://idp.test',
  email: 'admin@regulated-config.test',
  name: 'Admin',
  emailVerified: true as const,
}

await maybeBootstrapInstanceAdmin(admin)
useAuditLedger(await openLedger(immudbConfig()))
await initAudit()

async function sessionHeaders() {
  return { cookie: await sealedSessionCookie(admin), origin: 'http://localhost' }
}

describe('regulated config admin routes', () => {
  before(async () => {
    resetRegulatedConfigStatus()
    await recordRegulatedConfigAtStart({ dataDir: process.env.AUTH_DATA_DIR! })
  })

  it('rejects unauthenticated access', async () => {
    const app = new Hono()
    registerRegulatedConfigRoutes(app, { audit: auditMutation })
    assert.equal((await app.request('/auth/admin/regulated-config')).status, 401)
  })

  it('returns the effective regulated configuration for an admin', async () => {
    const app = new Hono()
    registerRegulatedConfigRoutes(app, { audit: auditMutation })
    const res = await app.request('/auth/admin/regulated-config', {
      headers: await sessionHeaders(),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      config: { gxpStrict: boolean; reason: { minLength: number } }
      digest: string
      recordedAt: string
    }
    assert.equal(body.config.gxpStrict, true)
    assert.ok(body.config.reason.minLength >= 1)
    assert.match(body.digest, /^sha256:/)
    assert.ok(body.recordedAt)
  })
})
