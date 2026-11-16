import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAuditChainGate, type AuditVerification } from './auditChainGate.js'

const ok = (overrides: Partial<Extract<AuditVerification, { ok: true }>> = {}): AuditVerification => ({
  ok: true,
  events: 3,
  head: 10,
  root: 'abc',
  verifiedAt: '2026-11-13T00:00:00.000Z',
  ...overrides,
})

const broken = (
  seq: number,
  reason: string,
  overrides: Partial<Extract<AuditVerification, { ok: false }>> = {},
): AuditVerification => ({
  ok: false,
  events: 2,
  verifiedAt: '2026-11-13T00:00:00.000Z',
  firstBreak: { seq, reason },
  ...overrides,
})

describe('auditChainGate', () => {
  it('is not blocked before any verification', () => {
    const gate = createAuditChainGate()
    assert.equal(gate.current(), null)
    assert.equal(gate.isBlocked(), false)
    assert.equal(gate.acknowledge(), null)
  })

  it('is not blocked after a successful verification', () => {
    const gate = createAuditChainGate()
    const v = ok()
    gate.recordVerification(v)
    assert.deepEqual(gate.current(), v)
    assert.equal(gate.isBlocked(), false)
    assert.equal(gate.acknowledge(), null)
  })

  it('blocks on a failed verification until that break is acknowledged', () => {
    const gate = createAuditChainGate()
    gate.recordVerification(broken(7, 'record value does not match its stored hash'))
    assert.equal(gate.isBlocked(), true)

    const ack = gate.acknowledge()
    assert.deepEqual(ack, { seq: 7, reason: 'record value does not match its stored hash' })
    assert.equal(gate.isBlocked(), false)
  })

  it('blocks again when a different break appears after acknowledgement', () => {
    const gate = createAuditChainGate()
    gate.recordVerification(broken(7, 'first break'))
    gate.acknowledge()
    assert.equal(gate.isBlocked(), false)

    gate.recordVerification(broken(12, 'second break'))
    assert.equal(gate.isBlocked(), true)
  })

  it('blocks again when the same seq fails for a different reason', () => {
    const gate = createAuditChainGate()
    gate.recordVerification(broken(7, 'first reason'))
    gate.acknowledge()
    gate.recordVerification(broken(7, 'different reason'))
    assert.equal(gate.isBlocked(), true)
  })

  it('clears the block when a later verification succeeds', () => {
    const gate = createAuditChainGate()
    gate.recordVerification(broken(7, 'tampered'))
    assert.equal(gate.isBlocked(), true)
    gate.recordVerification(ok({ events: 4, head: 11 }))
    assert.equal(gate.isBlocked(), false)
    assert.equal(gate.acknowledge(), null)
  })
})
