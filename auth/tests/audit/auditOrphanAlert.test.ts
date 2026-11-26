import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMPTY_AUDIT_CHANGE } from '../../src/packages/audit/lib/auditChange.js'
import type { AuditEvent } from '../../src/packages/audit/lib/audit.js'
import {
  agedOrphanIntents,
  isAgedOrphanIntent,
  orphanListAnnotation,
  prioritizeOrphanIntents,
} from '../../src/packages/audit/lib/auditOrphanAlert.js'

const actor = {
  sub: 'u1',
  iss: 'https://idp.test',
  email: 'u1@test',
  name: 'U1',
}

function intent(partial: Partial<AuditEvent> & Pick<AuditEvent, 'id' | 'ts'>): AuditEvent {
  return {
    actor,
    via: 'session',
    method: 'POST',
    path: '/api/x',
    status: 0,
    action: 'merge',
    phase: 'intent',
    resource_uri: 'action:merge',
    schema_version: 2,
    change: EMPTY_AUDIT_CHANGE,
    ...partial,
  }
}

function outcome(intentId: string, ts: string): AuditEvent {
  return {
    id: `out-${intentId}`,
    ts,
    actor,
    via: 'session',
    method: 'POST',
    path: '/api/x',
    status: 200,
    action: 'merge',
    phase: 'outcome',
    intent_id: intentId,
    resource_uri: 'action:merge',
    change: EMPTY_AUDIT_CHANGE,
    schema_version: 2,
  }
}

describe('agedOrphanIntents', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z')
  const thresholdMs = 15 * 60 * 1000

  it('returns unpaired intents older than the threshold', () => {
    const old = intent({
      id: 'i-old',
      ts: new Date(now - thresholdMs - 1).toISOString(),
    })
    const young = intent({
      id: 'i-young',
      ts: new Date(now - thresholdMs + 60_000).toISOString(),
    })
    const resolved = intent({
      id: 'i-done',
      ts: new Date(now - thresholdMs - 1).toISOString(),
    })
    const found = agedOrphanIntents(
      [old, young, resolved, outcome('i-done', new Date(now).toISOString())],
      now,
      thresholdMs,
    )
    assert.deepEqual(
      found.map((e) => e.id),
      ['i-old'],
    )
  })

  it('returns nothing when every orphan is still within the threshold', () => {
    const young = intent({
      id: 'i-young',
      ts: new Date(now - 60_000).toISOString(),
    })
    assert.deepEqual(agedOrphanIntents([young], now, thresholdMs), [])
  })
})

describe('prioritizeOrphanIntents', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z')
  const thresholdMs = 15 * 60 * 1000

  it('puts aged orphans before young unpaired intents before other events', () => {
    const aged = intent({
      id: 'aged',
      ts: new Date(now - thresholdMs - 1).toISOString(),
    })
    const young = intent({
      id: 'young',
      ts: new Date(now - 60_000).toISOString(),
    })
    const pairedIntent = intent({
      id: 'paired',
      ts: new Date(now - thresholdMs - 1).toISOString(),
    })
    const done = outcome('paired', new Date(now).toISOString())
    const ordered = prioritizeOrphanIntents(
      [done, pairedIntent, young, aged],
      now,
      thresholdMs,
    )
    assert.deepEqual(
      ordered.map((e) => e.id),
      ['aged', 'young', 'out-paired', 'paired'],
    )
  })
})

describe('orphanListAnnotation', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z')
  const thresholdMs = 15 * 60 * 1000

  it('marks unpaired intents; aged when past threshold', () => {
    const aged = intent({
      id: 'a',
      ts: new Date(now - thresholdMs - 1).toISOString(),
    })
    const young = intent({
      id: 'y',
      ts: new Date(now - 60_000).toISOString(),
    })
    assert.deepEqual(orphanListAnnotation(aged, now, thresholdMs), { orphan: true, orphan_aged: true })
    assert.deepEqual(orphanListAnnotation(young, now, thresholdMs), { orphan: true, orphan_aged: false })
    assert.deepEqual(
      orphanListAnnotation(outcome('a', new Date(now).toISOString()), now, thresholdMs),
      {},
    )
    assert.equal(isAgedOrphanIntent(aged, now, thresholdMs), true)
    assert.equal(isAgedOrphanIntent(young, now, thresholdMs), false)
  })
})
