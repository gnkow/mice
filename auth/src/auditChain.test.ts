import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth()
const {
  appendAudit,
  initAudit,
  verifyAudit,
  queryAudit,
  startAuditVerifySchedule,
  auditReadiness,
} = await import('./audit.js')
const { createAppendOnlyLog } = await import('./stores.js')
const { fakeClock } = await import('./clock.js')
const { appendText, createMemoryJsonBackend, readText, useJsonBackend, writeText } = await import('./jsonStore.js')

const FILE = '/mice-memory-data/audit.jsonl'
const actor = { sub: 's1', email: 'a@x.io', name: 'Ann', iss: 'iss' }
const ZERO = '0'.repeat(64)

function add(action: string) {
  return appendAudit({ actor, via: 'session', method: 'POST', path: '/x', status: 200, action })
}
const lines = () => (readText(FILE) ?? '').split('\n').filter(Boolean)
const rows = () => lines().map((l) => JSON.parse(l) as Record<string, unknown>)

let restore: () => void
beforeEach(() => {
  restore = useJsonBackend(createMemoryJsonBackend())
})
afterEach(() => restore())

describe('audit chain', () => {
  it('starts at a genesis event and links every event to its predecessor', () => {
    const a = add('file.write')!
    const b = add('file.delete')!
    assert.equal(a.prev_hash, rows()[0]!.hash)
    assert.equal(b.prev_hash, a.hash)
    assert.equal(rows()[0]!.action, 'audit.genesis')
    assert.equal(rows()[0]!.prev_hash, ZERO)
    assert.match(a.hash, /^[0-9a-f]{64}$/)
  })

  it('verifies an intact chain', () => {
    add('file.write')
    add('file.delete')
    const v = verifyAudit()
    assert.equal(v.ok, true)
    assert.equal(v.events, 3)
  })

  it('reports the first break when an event is edited', async () => {
    add('file.write')
    const victim = add('file.delete')!
    add('merge')
    writeText(FILE, readText(FILE)!.replace('"file.delete"', '"file.write"'))
    const v = verifyAudit()
    assert.equal(v.ok, false)
    if (!v.ok) {
      assert.equal(v.firstBreak.id, victim.id)
      assert.equal(v.firstBreak.index, 2)
      assert.match(v.firstBreak.reason, /hash/)
    }
  })

  it('reports a deleted event at its successor', async () => {
    add('a.one')
    add('a.two')
    const after = add('a.three')!
    const ls = readText(FILE)!.split('\n').filter(Boolean)
    ls.splice(2, 1)
    writeText(FILE, `${ls.join('\n')}\n`)
    const v = verifyAudit()
    assert.equal(v.ok, false)
    if (!v.ok) assert.equal(v.firstBreak.id, after.id)
  })

  it('reports an unparseable line instead of skipping it', async () => {
    add('a.one')
    appendText(FILE, '{broken\n')
    const v = verifyAudit()
    assert.equal(v.ok, false)
    if (!v.ok) assert.match(v.firstBreak.reason, /parse/)
  })

  it('lists events without the genesis event', () => {
    add('file.write')
    assert.deepEqual(queryAudit({}).events.map((e) => e.action), ['file.write'])
  })
})

describe('audit boot', () => {
  it('refuses a non-empty log that has no hashes', async () => {
    appendText(FILE, `${JSON.stringify({ id: 'old', ts: 't', action: 'x' })}\n`)
    assert.throws(() => initAudit(), /unchained|not hash-chained/i)
    assert.equal(lines().length, 1)
  })

  it('writes genesis on an empty log and reports a verified chain', () => {
    const v = initAudit()
    assert.equal(v.ok, true)
    assert.equal(rows().length, 1)
    assert.equal(initAudit().events, 1)
  })
})

describe('append-only storage', () => {
  it('exposes no rewrite path', () => {
    const log = createAppendOnlyLog<{ n: number }>('/mice-memory-data/x.jsonl')
    assert.equal('rewrite' in log, false)
    assert.equal('appendRaw' in log, false)
  })
})

describe('scheduled verification', () => {
  it('re-verifies when the interval has elapsed on the clock and shows the result in readiness', () => {
    const clock = fakeClock()
    add('file.write')
    const schedule = startAuditVerifySchedule({ clock, intervalMs: 60_000, poll: false })
    assert.equal(schedule.tick(), false)
    clock.advance(60_000)
    assert.equal(schedule.tick(), true)
    assert.equal(auditReadiness().ok, true)
    writeText(FILE, readText(FILE)!.replace('"file.write"', '"file.read"'))
    clock.advance(60_000)
    assert.equal(schedule.tick(), true)
    const r = auditReadiness()
    assert.equal(r.ok, false)
    assert.equal(r.chain, 'broken')
    schedule.stop()
  })
})
