import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-audit-health-'))
process.env.SESSION_SECRET = 'test-session-secret-for-audit-health'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@audit-health.test'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.IMMUDB_HA = 'true'

const { Hono } = await import('hono')
const { registerAuditHealthRoutes } = await import('./auditHealthRoutes.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { auditMutation } = await import('./auditMutation.js')
const { closeAuditOutage, currentAuditOutage, noteAuditOutage } = await import('./auditOutage.js')
const { initAudit, useAuditLedger } = await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { sealedSessionCookie } = await import('./testSupport.js')

const admin = {
  sub: 'admin',
  iss: 'https://idp.test',
  email: 'admin@audit-health.test',
  name: 'Admin',
  emailVerified: true as const,
}

await maybeBootstrapInstanceAdmin(admin)
await initAudit()

async function sessionHeaders() {
  return { cookie: await sealedSessionCookie(admin), origin: 'http://localhost' }
}

describe('audit health admin routes', () => {
  let app: ReturnType<typeof Hono>

  beforeEach(async () => {
    await closeAuditOutage(Date.now())
    app = new Hono()
    registerAuditHealthRoutes(app, { audit: auditMutation })
  })

  it('rejects unauthenticated status and check', async () => {
    assert.equal((await app.request('/auth/admin/audit-health/status')).status, 401)
    assert.equal((await app.request('/auth/admin/audit-health/check', { method: 'POST' })).status, 401)
  })

  it('returns readiness, HA attestation, and outage history for an admin', async () => {
    const res = await app.request('/auth/admin/audit-health/status', { headers: await sessionHeaders() })
    assert.equal(res.status, 200)
    const body = await res.json() as {
      readiness: { ok: boolean; store: string; chain: string }
      ha: { attested: boolean }
      currentOutage: null | { check: string }
      recentOutages: unknown[]
    }
    assert.equal(body.readiness.ok, true)
    assert.equal(body.ha.attested, true)
    assert.equal(body.currentOutage, null)
    assert.ok(Array.isArray(body.recentOutages))
    assert.ok(body.chainTip === null || typeof body.chainTip?.root === 'string')
  })

  it('check closes a recovered outage and reports verification with IQP tip fields', async () => {
    await noteAuditOutage({ at: Date.now() - 1000, check: 'append', requestId: 'stale' })
    assert.ok(await currentAuditOutage())
    const res = await app.request('/auth/admin/audit-health/check', {
      method: 'POST',
      headers: await sessionHeaders(),
    })
    assert.equal(res.status, 200)
    const body = await res.json() as {
      verification: { ok: boolean; head?: number; root?: string }
      chainTip: { txid: number; root: string } | null
      currentOutage: null | object
      checkedAt: string
    }
    assert.equal(body.verification.ok, true)
    assert.equal(typeof body.verification.head, 'number')
    assert.equal(typeof body.verification.root, 'string')
    assert.ok(body.chainTip)
    assert.equal(body.chainTip.root, body.verification.root)
    assert.equal(body.currentOutage, null)
    assert.ok(body.checkedAt)
  })

  it('check opens an outage when the ledger is unreachable', async () => {
    const real = await openLedger(immudbConfig())
    useAuditLedger({
      ...real,
      health: async () => ({ ok: false as const, detail: 'immudb: simulated outage' }),
      verify: async () => ({
        ok: false as const,
        events: 0,
        verifiedAt: new Date().toISOString(),
        firstBreak: { seq: 0, reason: 'immudb: simulated outage' },
      }),
      append: async () => {
        throw new Error('immudb: simulated outage')
      },
    })
    try {
      const res = await app.request('/auth/admin/audit-health/check', {
        method: 'POST',
        headers: await sessionHeaders(),
      })
      assert.equal(res.status, 200)
      const body = await res.json() as {
        readiness: { ok: boolean }
        currentOutage: { check: string; paperProcedure: string } | null
      }
      assert.equal(body.readiness.ok, false)
      assert.ok(body.currentOutage)
      assert.equal(body.currentOutage.check, 'admin_check')
      assert.equal(body.currentOutage.paperProcedure, 'validation-pack:audit-outage')
    } finally {
      useAuditLedger(real)
    }
  })
})
