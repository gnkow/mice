import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  carryFromIntent,
  createAuditIntentOutcome,
  orphanIntents,
  type IntentOutcomeEvent,
} from './auditIntentOutcome.js'

type FakeInput = {
  id?: string
  status?: number
  action?: string
  reason?: string
  reason_source?: 'explicit' | 'commit-message'
  category?: string
  change_control_id?: string
  signature_id?: string
}

function fakeStore() {
  const events: IntentOutcomeEvent[] = []
  let n = 0
  const append = async (
    partial: FakeInput,
    extra: Pick<IntentOutcomeEvent, 'phase' | 'intent_id'>,
  ): Promise<IntentOutcomeEvent> => {
    const event: IntentOutcomeEvent = {
      id: partial.id ?? `e${++n}`,
      ...extra,
      reason: partial.reason,
      reason_source: partial.reason_source,
      category: partial.category,
      change_control_id: partial.change_control_id,
      signature_id: partial.signature_id,
    }
    events.push(event)
    return event
  }
  return {
    events,
    store: {
      appendIntent: (p: FakeInput) => append(p, { phase: 'intent' }),
      appendOutcome: (intentId: string, p: FakeInput) =>
        append(p, { phase: 'outcome', intent_id: intentId }),
      appendAudit: (p: FakeInput) => append(p, {}),
    },
  }
}

describe('carryFromIntent', () => {
  it('copies reason, change-control and signature onto the Outcome carry bag', () => {
    assert.deepEqual(
      carryFromIntent({
        reason: 'Corrected assay layout after DEV-12',
        reason_source: 'explicit',
        category: 'data_correction',
        change_control_id: 'CC-20261113-aabbccdd',
        signature_id: 'sig-1',
      }),
      {
        reason: 'Corrected assay layout after DEV-12',
        reason_source: 'explicit',
        category: 'data_correction',
        change_control_id: 'CC-20261113-aabbccdd',
        signature_id: 'sig-1',
      },
    )
    assert.equal(carryFromIntent({}), undefined)
  })
})

describe('orphanIntents', () => {
  it('lists intents that never received an outcome', () => {
    const events: IntentOutcomeEvent[] = [
      { id: 'orphan', phase: 'intent' },
      { id: 'done', phase: 'intent' },
      { id: 'out', phase: 'outcome', intent_id: 'done' },
      { id: 'plain' },
    ]
    assert.deepEqual(
      orphanIntents(events).map((e) => e.id),
      ['orphan'],
    )
  })
})

describe('createAuditIntentOutcome', () => {
  it('links beginTrackedIntent → appendOutcomeFor with carried reason fields', async () => {
    const { store, events } = fakeStore()
    const io = createAuditIntentOutcome(store)
    const req = {}
    const intent = await io.beginTrackedIntent(req, {
      reason: 'Routine settings correction for assay batch',
      reason_source: 'explicit',
      category: 'privileged_settings',
      change_control_id: 'CC-20261113-aabbccdd',
      signature_id: 'sig-9',
    })
    assert.equal(io.trackedIntent(req)?.id, intent.id)
    assert.equal(io.trackedIntent(req)?.outcomes, 0)

    const outcome = await io.appendOutcomeFor(req, { status: 200, action: 'instance.permissions.update' })
    assert.ok(outcome)
    assert.equal(outcome.phase, 'outcome')
    assert.equal(outcome.intent_id, intent.id)
    assert.equal(outcome.reason, 'Routine settings correction for assay batch')
    assert.equal(outcome.change_control_id, 'CC-20261113-aabbccdd')
    assert.equal(outcome.signature_id, 'sig-9')
    assert.equal(io.trackedIntent(req)?.outcomes, 1)
    assert.equal(orphanIntents(events).length, 0)
  })

  it('falls back to appendAudit when the request has no tracked intent', async () => {
    const { store, events } = fakeStore()
    const io = createAuditIntentOutcome(store)
    const event = await io.appendOutcomeFor({}, { status: 200, action: 'login' })
    assert.ok(event)
    assert.equal(event.phase, undefined)
    assert.equal(events.length, 1)
  })

  it('leaves an intent orphan until an outcome is written', async () => {
    const { store, events } = fakeStore()
    const io = createAuditIntentOutcome(store)
    const req = {}
    await io.beginTrackedIntent(req, {})
    assert.deepEqual(
      orphanIntents(events).map((e) => e.id),
      [io.trackedIntent(req)!.id],
    )
  })
})
