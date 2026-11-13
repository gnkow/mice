import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth()
const {
  beginTrackedIntent,
  appendOutcomeFor,
  actorFromUser,
  queryAudit,
} = await import('./audit.js')

const actor = actorFromUser(iso.admin)
const base = {
  actor,
  via: 'session' as const,
  method: 'PATCH',
  path: '/auth/namespaces/demo',
}

describe('Outcome inherits Intent reason and change-control', () => {
  it('appendOutcomeFor carries reason/CC/signature from the tracked Intent', async () => {
    const request = {}
    const intent = await beginTrackedIntent(request, {
      ...base,
      status: 0,
      action: 'bff.mutation',
      reason: 'Adjusted namespace visibility for audit review',
      reason_source: 'explicit',
      category: 'privileged_settings',
      change_control_id: 'CC-20261113-deadbeef',
      signature_id: 'sig-integration-1',
    })

    const outcome = await appendOutcomeFor(request, {
      ...base,
      status: 200,
      action: 'namespace.settings.update',
      namespace: 'demo',
    })
    assert.ok(outcome)
    assert.equal(outcome!.intent_id, intent.id)
    assert.equal(outcome!.reason, intent.reason)
    assert.equal(outcome!.reason_source, intent.reason_source)
    assert.equal(outcome!.category, intent.category)
    assert.equal(outcome!.change_control_id, intent.change_control_id)
    assert.equal(outcome!.signature_id, intent.signature_id)

    const listed = await queryAudit({ action: 'namespace.settings.update', limit: 20 })
    const row = listed.events.find((e) => e.id === outcome!.id)
    assert.ok(row)
    assert.equal(row!.change_control_id, 'CC-20261113-deadbeef')
    assert.equal(row!.reason, 'Adjusted namespace visibility for audit review')
  })
})
