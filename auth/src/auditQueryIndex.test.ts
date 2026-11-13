import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auditQueryIndexIsHealthy,
  auditQueryIndexStatus,
  clearAuditQueryIndexDrift,
  projectAuditQueryIndex,
  queryAuditQueryIndex,
  verifyAuditQueryIndex,
} from './auditQueryIndex.js'
import type { AuditEvent } from './audit.js'

const actor = { sub: 'idx-a', iss: 'test', email: 'idx@example.com', name: 'Idx' }

function ev(partial: Partial<AuditEvent> & Pick<AuditEvent, 'id' | 'action'>): AuditEvent {
  return {
    ts: '2026-06-01T12:00:00.000Z',
    actor,
    via: 'session',
    method: 'POST',
    path: '/x',
    status: 200,
    ...partial,
  }
}

describe('audit query index', () => {
  it('serves filtered reads without needing a ledger scan', async () => {
    await clearAuditQueryIndexDrift()
    await projectAuditQueryIndex(ev({ id: 'qi-1', action: 'commit.publish', namespace: 'ns-a' }), 10)
    await projectAuditQueryIndex(
      ev({ id: 'qi-2', action: 'file.write', namespace: 'ns-b', ts: '2026-06-02T12:00:00.000Z' }),
      11,
    )

    const filtered = await queryAuditQueryIndex({ namespace: 'ns-a' })
    assert.ok(filtered)
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0]!.id, 'qi-1')
    assert.equal((await auditQueryIndexStatus()).status, 'ok')
    assert.equal(await auditQueryIndexIsHealthy(), true)
  })

  it('marks drift and refuses the index path when ledger ids disagree', async () => {
    await clearAuditQueryIndexDrift()
    await projectAuditQueryIndex(ev({ id: 'qi-drift', action: 'other', namespace: 'ns' }), 20)
    const result = await verifyAuditQueryIndex({
      ledgerEventIds: async () => ['qi-drift', 'missing-from-index'],
    })
    assert.equal(result.ok, false)
    assert.equal(await auditQueryIndexIsHealthy(), false)
    assert.equal(await queryAuditQueryIndex({ namespace: 'ns' }), null)
  })
})
