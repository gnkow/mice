import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeAuditReadiness } from './auditReadiness.js'

describe('composeAuditReadiness', () => {
  it('reports unverified when no verification has run', () => {
    const r = composeAuditReadiness({
      lastAppendError: null,
      health: { ok: true },
      verification: null,
      chainBlocked: false,
    })
    assert.equal(r.ok, true)
    assert.equal(r.store, 'ok')
    assert.equal(r.chain, 'unverified')
  })

  it('exposes head and root when the chain verifies', () => {
    const r = composeAuditReadiness({
      lastAppendError: null,
      health: { ok: true },
      verification: {
        ok: true,
        events: 3,
        verifiedAt: '2026-01-01T00:00:00.000Z',
        head: 9,
        root: 'abc',
      },
      chainBlocked: false,
    })
    assert.equal(r.ok, true)
    assert.equal(r.chain, 'ok')
    assert.equal(r.head, 9)
    assert.equal(r.root, 'abc')
  })

  it('is not ready while the chain is broken and unacknowledged', () => {
    const r = composeAuditReadiness({
      lastAppendError: null,
      health: { ok: true },
      verification: {
        ok: false,
        events: 2,
        verifiedAt: '2026-01-01T00:00:00.000Z',
        firstBreak: { seq: 1, reason: 'tamper' },
      },
      chainBlocked: true,
    })
    assert.equal(r.ok, false)
    assert.equal(r.chain, 'broken')
    assert.equal(r.firstBreak?.seq, 1)
  })

  it('stays ready after an acknowledged break', () => {
    const r = composeAuditReadiness({
      lastAppendError: null,
      health: { ok: true },
      verification: {
        ok: false,
        events: 2,
        verifiedAt: '2026-01-01T00:00:00.000Z',
        firstBreak: { seq: 1, reason: 'tamper' },
      },
      chainBlocked: false,
    })
    assert.equal(r.ok, true)
    assert.equal(r.chain, 'acknowledged')
  })

  it('marks store error from health even when append error cleared', () => {
    const r = composeAuditReadiness({
      lastAppendError: 'stale',
      health: { ok: false, detail: 'unreachable' },
      verification: null,
      chainBlocked: false,
    })
    assert.equal(r.ok, false)
    assert.equal(r.store, 'error')
    assert.equal(r.detail, 'unreachable')
  })

  it('clears a stale append error when health is ok again', () => {
    const r = composeAuditReadiness({
      lastAppendError: 'earlier write failed',
      health: { ok: true },
      verification: null,
      chainBlocked: false,
    })
    assert.equal(r.store, 'ok')
    assert.equal(r.detail, undefined)
    assert.equal(r.ok, true)
  })
})
