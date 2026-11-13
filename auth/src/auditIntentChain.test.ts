import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  carryFromIntent,
  orphanIntents,
  type AuditEvent,
} from './audit.js'

const base = {
  ts: '2026-11-13T12:00:00.000Z',
  actor: { sub: 'u', iss: 'https://idp.test', email: 'u@x.io', name: 'U' },
  via: 'session' as const,
  method: 'POST',
  path: '/auth/x',
  status: 0,
  action: 'bff.mutation',
}

describe('carryFromIntent', () => {
  it('copies reason, change-control and signature onto the Outcome carry bag', () => {
    const intent = {
      ...base,
      id: 'i1',
      phase: 'intent' as const,
      reason: 'Corrected assay layout after DEV-12',
      reason_source: 'explicit' as const,
      category: 'data_correction',
      change_control_id: 'CC-20261113-aabbccdd',
      signature_id: 'sig-1',
    }
    assert.deepEqual(carryFromIntent(intent), {
      reason: 'Corrected assay layout after DEV-12',
      reason_source: 'explicit',
      category: 'data_correction',
      change_control_id: 'CC-20261113-aabbccdd',
      signature_id: 'sig-1',
    })
    assert.equal(carryFromIntent({ ...base, id: 'i2', phase: 'intent' }), undefined)
  })
})

describe('orphanIntents', () => {
  it('lists intents that never received an outcome', () => {
    const events: AuditEvent[] = [
      { ...base, id: 'orphan', phase: 'intent', status: 0 },
      { ...base, id: 'done', phase: 'intent', status: 0 },
      { ...base, id: 'out', phase: 'outcome', intent_id: 'done', status: 200, action: 'bff.mutation' },
      { ...base, id: 'plain', status: 200, action: 'login' },
    ]
    assert.deepEqual(
      orphanIntents(events).map((e) => e.id),
      ['orphan'],
    )
  })
})
