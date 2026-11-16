import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth()
const { appendAudit, initAudit, queryAudit, useAuditLedger, listAllAuditEvents } = await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const {
  auditQueryIndexIsHealthy,
  clearAuditQueryIndexDrift,
  queryAuditQueryIndex,
  verifyAuditQueryIndex,
} = await import('./auditQueryIndex.js')

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
