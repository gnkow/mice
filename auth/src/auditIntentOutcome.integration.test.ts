import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth()
const {
  beginTrackedIntent,
  appendOutcomeFor,
  orphanIntents,
  listAllAuditEvents,
  initAudit,
  useAuditLedger,
} = await import('./audit.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')

const ledger = await openLedger(immudbConfig())
useAuditLedger(ledger)
await initAudit()

const actor = { sub: 'io-integ', iss: 'test', email: 'io@ex.com', name: 'IO' }

after(() => iso.restore())

describe('audit Intent↔Outcome integration', () => {
  it('carries reason fields from tracked Intent onto Outcome in the ledger', async () => {
    const req = {}
    const intent = await beginTrackedIntent(req, {
      actor,
      via: 'session',
      method: 'POST',
      path: '/auth/x',
      status: 0,
      action: 'bff.mutation',
      reason: 'Routine settings correction for assay batch',
      reason_source: 'explicit',
      category: 'privileged_settings',
      change_control_id: 'CC-20261113-aabbccdd',
    })
    const outcome = await appendOutcomeFor(req, {
      actor,
      via: 'session',
      method: 'POST',
      path: '/auth/x',
      status: 200,
      action: 'instance.permissions.update',
    })
    assert.ok(outcome)
    assert.equal(outcome.intent_id, intent.id)
    assert.equal(outcome.reason, intent.reason)
    assert.equal(outcome.change_control_id, intent.change_control_id)
    assert.equal(orphanIntents(await listAllAuditEvents()).some((e) => e.id === intent.id), false)
  })
})
