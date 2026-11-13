import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { verifyAudit, useAuditLedger } = await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { auditChainGate } = await import('./auditChainGate.js')

const real = await openLedger(immudbConfig())
useAuditLedger(real)
const app = createApp()

describe('/readyz audit readiness', () => {
  it('returns 200 with chain ok after a successful verify', async () => {
    await verifyAudit()
    const res = await app.request('/readyz')
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      ok: boolean
      audit: { store: string; chain: string; head?: number; root?: string }
    }
    assert.equal(body.ok, true)
    assert.equal(body.audit.store, 'ok')
    assert.equal(body.audit.chain, 'ok')
    assert.equal(typeof body.audit.head, 'number')
    assert.equal(typeof body.audit.root, 'string')
  })

  it('returns 503 with chain broken while the gate blocks', async () => {
    auditChainGate.recordVerification({
      ok: false,
      events: 1,
      verifiedAt: new Date().toISOString(),
      firstBreak: { seq: 1, reason: 'integration forced break' },
    })
    const res = await app.request('/readyz')
    assert.equal(res.status, 503)
    const body = (await res.json()) as { ok: boolean; audit: { chain: string } }
    assert.equal(body.ok, false)
    assert.equal(body.audit.chain, 'broken')
    // Restore for other suites sharing the process gate.
    await verifyAudit()
  })
})
