import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AuditEvent } from './audit.js'
import {
  agedOrphanIntents,
  alertAgedOrphanIntents,
  createOrphanAgingAlerter,
  orphanAlertNotification,
} from './auditOrphanAlert.js'

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

describe('alertAgedOrphanIntents', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z')
  const thresholdMs = 15 * 60 * 1000

  it('notifies once per aged orphan (no ledger write path)', async () => {
    const orphan = intent({
      id: 'i-orphan',
      ts: new Date(now - thresholdMs - 1).toISOString(),
      action: 'workspace.merge',
    })
    const notified: string[] = []
    const alerted = new Set<string>()

    const first = await alertAgedOrphanIntents({
      now,
      thresholdMs,
      loadEvents: async () => [orphan],
      listAdmins: async () => [{ iss: 'https://idp.test', sub: 'admin' }],
      notify: async (n) => {
        notified.push(n.id)
      },
      wasAlerted: (id) => alerted.has(id),
      markAlerted: (id) => {
        alerted.add(id)
      },
    })
    assert.deepEqual(first, ['i-orphan'])
    assert.deepEqual(notified, ['audit-orphan:i-orphan'])

    const second = await alertAgedOrphanIntents({
      now,
      thresholdMs,
      loadEvents: async () => [orphan],
      listAdmins: async () => [{ iss: 'https://idp.test', sub: 'admin' }],
      notify: async (n) => {
        notified.push(n.id)
      },
      wasAlerted: (id) => alerted.has(id),
      markAlerted: (id) => {
        alerted.add(id)
      },
    })
    assert.deepEqual(second, [])
    assert.deepEqual(notified, ['audit-orphan:i-orphan'])
  })

  it('skips notify when there are no instance admins', async () => {
    const orphan = intent({
      id: 'i-orphan-2',
      ts: new Date(now - thresholdMs - 1).toISOString(),
    })
    let calls = 0
    await alertAgedOrphanIntents({
      now,
      thresholdMs,
      loadEvents: async () => [orphan],
      listAdmins: async () => [],
      notify: async () => {
        calls += 1
      },
      wasAlerted: () => false,
      markAlerted: () => {},
    })
    assert.equal(calls, 0)
  })
})

describe('orphanAlertNotification', () => {
  it('builds a stable security notification for an aged Intent', () => {
    const orphan = intent({
      id: 'i-1',
      ts: '2026-11-13T11:00:00.000Z',
      action: 'workspace.merge',
    })
    const n = orphanAlertNotification({
      intent: orphan,
      now: Date.parse('2026-11-13T12:00:00.000Z'),
      thresholdMs: 15 * 60 * 1000,
      admins: [{ iss: 'https://idp.test', sub: 'admin' }],
    })
    assert.equal(n.id, 'audit-orphan:i-1')
    assert.equal(n.category, 'security')
    assert.equal(n.href, '/audit')
    assert.match(n.summary, /workspace\.merge/)
    assert.match(n.summary, /15 minutes/)
    assert.deepEqual(n.recipients, [{ iss: 'https://idp.test', sub: 'admin' }])
  })
})

describe('createOrphanAgingAlerter', () => {
  const now = Date.parse('2026-11-13T12:00:00.000Z')
  const thresholdMs = 15 * 60 * 1000

  it('owns dedupe so two alerters do not share alerted state', async () => {
    const orphan = intent({
      id: 'i-shared',
      ts: new Date(now - thresholdMs - 1).toISOString(),
      action: 'merge',
    })
    const notifiedA: string[] = []
    const notifiedB: string[] = []
    const ports = {
      loadEvents: async () => [orphan],
      listAdmins: async () => [{ iss: 'https://idp.test', sub: 'admin' }],
      now: () => now,
      thresholdMs,
    }
    const a = createOrphanAgingAlerter({
      ...ports,
      notify: async (n) => {
        notifiedA.push(n.id)
      },
    })
    const b = createOrphanAgingAlerter({
      ...ports,
      notify: async (n) => {
        notifiedB.push(n.id)
      },
    })

    assert.deepEqual(await a.tick(), ['i-shared'])
    assert.deepEqual(await a.tick(), [])
    assert.deepEqual(await b.tick(), ['i-shared'])
    assert.deepEqual(notifiedA, ['audit-orphan:i-shared'])
    assert.deepEqual(notifiedB, ['audit-orphan:i-shared'])
  })

  it('reset clears owned dedupe so the same Intent can alert again', async () => {
    const orphan = intent({
      id: 'i-reset',
      ts: new Date(now - thresholdMs - 1).toISOString(),
    })
    const notified: string[] = []
    const alerter = createOrphanAgingAlerter({
      loadEvents: async () => [orphan],
      listAdmins: async () => [{ iss: 'https://idp.test', sub: 'admin' }],
      notify: async (n) => {
        notified.push(n.id)
      },
      now: () => now,
      thresholdMs,
    })
    assert.deepEqual(await alerter.tick(), ['i-reset'])
    alerter.reset()
    assert.deepEqual(await alerter.tick(), ['i-reset'])
    assert.deepEqual(notified, ['audit-orphan:i-reset', 'audit-orphan:i-reset'])
  })
})
