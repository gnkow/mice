import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../src/packages/shared/lib/testSupport.js'

const iso = isolatedAuth()
const { appendAudit, initAudit, queryAudit, useAuditLedger, listAllAuditEvents } = await import('../src/packages/audit/lib/audit.js')
const { immudbConfig, openLedger } = await import('../src/packages/audit/lib/auditLedger.js')
const {
  auditQueryIndexIsHealthy,
  clearAuditQueryIndexDrift,
  queryAuditQueryIndex,
  verifyAuditQueryIndex,
} = await import('../src/packages/audit/lib/auditQueryIndex.js')

const ledger = await openLedger(immudbConfig())
useAuditLedger(ledger)
await initAudit()
await clearAuditQueryIndexDrift()

const actor = {
  sub: 'qi-integ',
  iss: 'test',
  email: 'qi@example.com',
  name: 'QI',
}

after(() => iso.restore())

describe('audit query index integration', () => {
  it('projects on append so queryAudit hits the index happy path', async () => {
    const event = await appendAudit({
      actor,
      via: 'session',
      method: 'POST',
      path: '/api/repos/qi-ns/r/commits/x/complete',
      status: 200,
      action: 'commit.publish',
      namespace: 'qi-ns',
      repo: 'r',
      message: 'index me',
    })
    assert.ok(event)

    // Direct index read proves we did not need a full immudb scan for the filter.
    const fromIndex = await queryAuditQueryIndex({ namespace: 'qi-ns', action: 'commit.publish' })
    assert.ok(fromIndex)
    assert.ok(fromIndex.some((e) => e.id === event.id))

    const { events } = await queryAudit({ namespace: 'qi-ns', action: 'commit.publish' })
    assert.ok(events.some((e) => e.id === event.id))

    const verified = await verifyAuditQueryIndex({
      ledgerEventIds: async () => (await listAllAuditEvents()).map((e) => e.id),
    })
    assert.equal(verified.ok, true)
    assert.equal(await auditQueryIndexIsHealthy(), true)
  })
})
