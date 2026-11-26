import './db/testSchema.js'
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-orphan-alert-'))
process.env.SESSION_SECRET = 'test-session-secret-for-orphan-alert'
process.env.AUDIT_ORPHAN_ALERT_SEC = '900'

const { appendIntent, appendOutcome, listAllAuditEvents, useAuditLedger, queryAudit } = await import('../src/packages/audit/lib/audit.js')
const { openLedger, immudbConfig } = await import('../src/packages/audit/lib/auditLedger.js')
const { agedOrphanIntents, orphanListAnnotation, prioritizeOrphanIntents } = await import('../src/packages/audit/lib/auditOrphanAlert.js')
const { useClock, fakeClock } = await import('../src/packages/shared/lib/clock.js')
const { overrideEnv } = await import('../src/packages/shared/lib/env.js')

const actor = {
  sub: 'scientist',
  iss: 'https://idp.test',
  email: 'sci@test',
  name: 'Sci',
}

beforeEach(async () => {
  useAuditLedger(await openLedger({ ...immudbConfig(), prefix: `orphan-alert/${crypto.randomUUID()}/`, lazy: true }))
})

describe('orphan aging visibility integration', () => {
  it('keeps unpaired Intents on the trail and ranks aged ones first (no admin notify)', async () => {
    const clock = fakeClock(Date.UTC(2026, 10, 13, 12, 0, 0))
    const restoreClock = useClock(clock)
    const restoreEnv = overrideEnv({ auditOrphanAlertSec: 900 })

    try {
      const intent = await appendIntent({
        actor,
        via: 'session',
        method: 'POST',
        path: '/api/ns/r/merge',
        status: 0,
        action: 'merge',
        ts: new Date(clock.now()).toISOString(),
      })
      await appendOutcome(intent.id, {
        actor,
        via: 'session',
        method: 'POST',
        path: '/api/ns/r/other',
        status: 200,
        action: 'file.write',
        ts: new Date(clock.now()).toISOString(),
      })
      // Second Intent left unpaired (honest gap).
      const orphan = await appendIntent({
        actor,
        via: 'session',
        method: 'POST',
        path: '/api/ns/r/merge',
        status: 0,
        action: 'workspace.merge',
        ts: new Date(clock.now()).toISOString(),
      })

      clock.advance(901_000)
      const events = await listAllAuditEvents()
      const aged = agedOrphanIntents(events, clock.now(), 900_000)
      assert.deepEqual(
        aged.map((e) => e.id),
        [orphan.id],
      )
      assert.equal(events.filter((e) => e.phase === 'outcome').length, 1)
      assert.deepEqual(orphanListAnnotation(orphan, clock.now(), 900_000), {
        orphan: true,
        orphan_aged: true,
      })

      const { events: page } = await queryAudit({ orphansOnly: true, limit: 50 })
      assert.ok(page.some((e) => e.id === orphan.id))
      assert.ok(page.every((e) => e.phase === 'intent'))
      const ranked = prioritizeOrphanIntents(events, clock.now(), 900_000)
      assert.equal(ranked[0]?.id, orphan.id)
    } finally {
      restoreClock()
      restoreEnv()
    }
  })
})
