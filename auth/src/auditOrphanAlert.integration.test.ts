import './db/testSchema.js'
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-orphan-alert-'))
process.env.SESSION_SECRET = 'test-session-secret-for-orphan-alert'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@orphan-alert.test'
process.env.AUDIT_ORPHAN_ALERT_SEC = '900'

const { appendIntent, listAllAuditEvents, useAuditLedger } = await import('./audit.js')
const { openLedger, immudbConfig } = await import('./auditLedger.js')
const { runOrphanAgingAlert, resetOrphanAlertState } = await import('./auditOrphanAlert.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { useNovu } = await import('./novu.js')
const { subscriberId } = await import('./notifications.js')
const { notificationUserKey } = await import('./notificationsStore.js')
const { useClock, fakeClock } = await import('./clock.js')
const { overrideEnv } = await import('./env.js')

const admin = {
  sub: 'admin',
  iss: 'https://idp.test',
  email: 'admin@orphan-alert.test',
  name: 'Admin',
  emailVerified: true as const,
}

const actor = {
  sub: 'scientist',
  iss: 'https://idp.test',
  email: 'sci@test',
  name: 'Sci',
}

beforeEach(async () => {
  resetOrphanAlertState()
  useAuditLedger(await openLedger({ ...immudbConfig(), prefix: `orphan-alert/${crypto.randomUUID()}/`, lazy: true }))
})

describe('orphan aging alert integration', () => {
  it('alerts admins for an Intent with no Outcome past the threshold', async () => {
    await maybeBootstrapInstanceAdmin(admin)
    const clock = fakeClock(Date.UTC(2026, 10, 13, 12, 0, 0))
    const restoreClock = useClock(clock)
    const restoreEnv = overrideEnv({ auditOrphanAlertSec: 900 })
    const triggered: Array<{ id: string; title?: string }> = []
    useNovu({
      async trigger(sub, eventId, payload) {
        triggered.push({ id: eventId, title: (payload as { title?: string }).title })
        assert.equal(sub, subscriberId(notificationUserKey(admin)))
      },
      async feed() {
        return []
      },
      async mark() {},
      async deleteSubscriber() {},
      async health() {
        return { ok: true }
      },
    })

    try {
      const intent = await appendIntent({
        actor,
        via: 'session',
        method: 'POST',
        path: '/api/ns/r/merge',
        status: 0,
        action: 'merge',
        // buildEvent still uses wall clock unless ts is supplied
        ts: new Date(clock.now()).toISOString(),
      })
      clock.advance(901_000)
      const alerted = await runOrphanAgingAlert({
        loadEvents: listAllAuditEvents,
        now: clock.now(),
        thresholdMs: 900_000,
      })
      assert.deepEqual(alerted, [intent.id])
      assert.equal(triggered.length, 1)
      assert.equal(triggered[0]?.id, `audit-orphan:${intent.id}`)
      assert.match(triggered[0]?.title ?? '', /Intent without Outcome/)

      const again = await runOrphanAgingAlert({
        loadEvents: listAllAuditEvents,
        now: clock.now(),
        thresholdMs: 900_000,
      })
      assert.deepEqual(again, [])
      assert.equal(triggered.length, 1)

      const events = await listAllAuditEvents()
      assert.equal(events.filter((e) => e.phase === 'intent').length, 1)
      assert.equal(events.filter((e) => e.phase === 'outcome').length, 0)
    } finally {
      restoreClock()
      restoreEnv()
    }
  })
})
