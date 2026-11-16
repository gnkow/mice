import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth()
const { appendAudit, appendIntent, appendOutcome, initAudit, queryAudit, useAuditLedger } =
  await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

const ledger = await openLedger(immudbConfig())
useAuditLedger(ledger)
await initAudit()

const actor = { sub: 'qf', iss: 'test', email: 'qf@ex.com', name: 'QF' }

after(() => iso.restore())

describe('audit query filters integration', () => {
  it('lists hide resolved intents while orphans stay visible', async () => {
    const intent = await appendIntent({
      actor,
      via: 'session',
      method: 'POST',
      path: '/x',
      status: 0,
      action: 'bff.mutation',
      namespace: 'qf-ns',
    })
    await appendOutcome(intent.id, {
      actor,
      via: 'session',
      method: 'POST',
      path: '/x',
      status: 200,
      action: 'bff.mutation',
      namespace: 'qf-ns',
    })
    const orphan = await appendIntent({
      actor,
      via: 'session',
      method: 'POST',
      path: '/y',
      status: 0,
      action: 'bff.mutation',
      namespace: 'qf-ns',
    })
    await appendAudit({
      actor,
      via: 'session',
      method: 'GET',
      path: '/z',
      status: 200,
      action: 'other',
      namespace: 'other-ns',
    })

    const { events } = await queryAudit({ namespace: 'qf-ns' })
    const ids = events.map((e) => e.id)
    assert.ok(!ids.includes(intent.id), 'resolved intent hidden')
    assert.ok(ids.includes(orphan.id), 'orphan intent visible')
    assert.ok(events.every((e) => e.namespace === 'qf-ns'))
  })
})
