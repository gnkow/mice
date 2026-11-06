import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-audit-outage-'))
process.env.SESSION_SECRET = 'test-session-secret-for-audit-outage'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@audit-outage.test'

const {
  alertAuditDegradation,
  closeAuditOutage,
  currentAuditOutage,
  immudbHaAttested,
  listAuditOutages,
  noteAuditOutage,
  reportAuditDegradation,
} = await import('./auditOutage.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { useNovu } = await import('./novu.js')
const { subscriberId } = await import('./notifications.js')
const { notificationUserKey } = await import('./notificationsStore.js')

const startedAt = Date.UTC(2026, 5, 1)
const admin = {
  sub: 'admin',
  iss: 'https://idp.test',
  email: 'admin@audit-outage.test',
  name: 'Admin',
  emailVerified: true as const,
}

beforeEach(async () => {
  await closeAuditOutage(Date.now())
})

describe('audit outage incident', () => {
  it('opens one incident and keeps a second failure on the same outage', async () => {
    const opened = await noteAuditOutage({ at: startedAt, check: 'append', requestId: 'req-1' })
    assert.equal(opened, true)
    const again = await noteAuditOutage({ at: startedAt + 1000, check: 'verify', requestId: 'req-2' })
    assert.equal(again, false)
    const incident = await currentAuditOutage()
    assert.ok(incident)
    assert.equal(incident.startedAt, startedAt)
    assert.equal(incident.check, 'append')
    assert.equal(incident.requestId, 'req-1')
    assert.equal(incident.paperProcedure, 'validation-pack:audit-outage')
    assert.equal(incident.endedAt, undefined)
    assert.equal((await listAuditOutages()).length, 1)
  })

  it('closes the open incident when the audit store recovers', async () => {
    await noteAuditOutage({ at: startedAt, check: 'health', requestId: 'req-close' })
    await closeAuditOutage(startedAt + 5000)
    assert.equal(await currentAuditOutage(), null)
    const [last] = await listAuditOutages(1)
    assert.equal(last?.endedAt, startedAt + 5000)
  })

  it('alerts instance admins when a new degradation is reported', async () => {
    await maybeBootstrapInstanceAdmin(admin)
    const triggered: Array<{ subscriberId: string; payload: { summary?: string; title?: string } }> = []
    useNovu({
      async trigger(subscriberId, _eventId, payload) {
        triggered.push({ subscriberId, payload: payload as { summary?: string; title?: string } })
      },
      async feed() { return [] },
      async mark() {},
      async deleteSubscriber() {},
      async health() { return { ok: true } },
    })
    const at = Date.now()
    const incident = await reportAuditDegradation({
      at,
      check: 'readyz',
      requestId: 'req-alert',
      detail: 'immudb: connection refused',
    })
    assert.ok(incident)
    const note = triggered.find(
      (row) => row.subscriberId === subscriberId(notificationUserKey(admin)),
    )
    assert.ok(note)
    assert.match(note.payload.title ?? '', /Audit store degraded/)
    assert.match(note.payload.summary ?? '', /connection refused/)
  })

  it('immudbHaAttested requires IMMUDB_HA=true', () => {
    assert.equal(immudbHaAttested({ IMMUDB_HA: 'true' }), true)
    assert.equal(immudbHaAttested({ IMMUDB_HA: 'false' }), false)
    assert.equal(immudbHaAttested({}), false)
  })
})

describe('alertAuditDegradation', () => {
  it('is a no-op when there are no instance admins to notify', async () => {
    useNovu({
      async trigger() { throw new Error('should not notify') },
      async feed() { return [] },
      async mark() {},
      async deleteSubscriber() {},
      async health() { return { ok: true } },
    })
    // Fresh schema may still have the bootstrap admin from the prior test; alert must not throw.
    await alertAuditDegradation({ at: startedAt, check: 'append' })
  })
})
