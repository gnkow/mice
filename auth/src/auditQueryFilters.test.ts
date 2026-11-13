import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyAuditQueryFilters, eventJobIds, eventSessionIds } from './auditQueryFilters.js'
import type { AuditFilterEvent } from './auditQueryFilters.js'

const actor = { sub: 'u1', email: 'u1@ex.com', name: 'U One' }

function ev(partial: Partial<AuditFilterEvent> & Pick<AuditFilterEvent, 'id' | 'action'>): AuditFilterEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    via: 'session',
    actor,
    ...partial,
  }
}

describe('applyAuditQueryFilters', () => {
  it('hides resolved intents unless includeChain is set', () => {
    const events = [
      ev({ id: 'o1', action: 'x', phase: 'outcome', intent_id: 'i1', ts: '2026-01-02T00:00:00.000Z' }),
      ev({ id: 'i1', action: 'x', phase: 'intent' }),
      ev({ id: 'orphan', action: 'y', phase: 'intent', ts: '2026-01-03T00:00:00.000Z' }),
    ]
    const listed = applyAuditQueryFilters(events, {})
    assert.deepEqual(
      listed.map((e) => e.id),
      ['o1', 'orphan'],
    )
    const chained = applyAuditQueryFilters(events, { includeChain: true })
    assert.equal(chained.length, 3)
  })

  it('filters by namespace, action alias, actor substring, and time window', () => {
    const events = [
      ev({
        id: 'a',
        action: 'repo.create',
        namespace: 'ns1',
        actor: { sub: 'alice', email: 'a@ex.com', name: 'Alice' },
        ts: '2026-02-01T00:00:00.000Z',
      }),
      ev({
        id: 'b',
        action: 'namespace.create',
        namespace: 'ns2',
        ts: '2026-03-01T00:00:00.000Z',
      }),
    ]
    assert.equal(applyAuditQueryFilters(events, { namespace: 'ns1' }).length, 1)
    assert.equal(applyAuditQueryFilters(events, { actor: 'ali' })[0]?.id, 'a')
    assert.equal(applyAuditQueryFilters(events, { since: '2026-02-15T00:00:00.000Z' })[0]?.id, 'b')
    assert.equal(applyAuditQueryFilters(events, { until: '2026-02-15T00:00:00.000Z' })[0]?.id, 'a')
  })

  it('matches session and job ids from detail', () => {
    const events = [
      ev({ id: 's', action: 'session.start', detail: { session_id: 'sess-1' } }),
      ev({ id: 'j', action: 'job.run', detail: { job_ids: ['job-9'] } }),
    ]
    assert.equal(eventSessionIds(events[0]!).join(), 'sess-1')
    assert.equal(eventJobIds(events[1]!).join(), 'job-9')
    assert.equal(applyAuditQueryFilters(events, { sessionId: 'sess-1' })[0]?.id, 's')
    assert.equal(applyAuditQueryFilters(events, { jobId: 'job-9' })[0]?.id, 'j')
  })
})
