import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-clock-drift-'))
process.env.SESSION_SECRET = 'test-session-secret-for-clock-drift'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'

const { decideClockDriftAlert, ntpTimeFromPacket, startClockDriftSchedule } = await import('./clockDriftAlert.js')
const { useNovu } = await import('../../novu.js')
const { subscriberId } = await import('../../notifications.js')
const { notificationUserKey } = await import('../../notificationsStore.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')

await maybeBootstrapInstanceAdmin({
  iss: 'idp',
  sub: 'admin1',
  email: 'admin1@test.com',
  name: 'admin1',
  emailVerified: true,
})

const server = Date.UTC(2026, 10, 2, 15, 0, 0)

describe('Clock drift alert', () => {
  it('decides an alert when drift is more than 1 second', () => {
    const decision = decideClockDriftAlert(server, server + 2000)
    assert.equal(decision.alert, true)
    if (!decision.alert) return
    assert.equal(decision.driftMs, 2000)
    assert.match(decision.message, /2000/)
  })

  it('decides no alert when drift is 1 second or less', () => {
    assert.equal(decideClockDriftAlert(server, server + 1000).alert, false)
    assert.equal(decideClockDriftAlert(server, server + 500).alert, false)
  })

  it('alerts instance admins when the server clock is more than 1 second from NTP', async () => {
    const triggered: Array<{ subscriberId: string; payload: { summary?: string; title?: string; category?: string } }> = []
    useNovu({
      async trigger(subscriberId, _eventId, payload) {
        triggered.push({ subscriberId, payload: payload as { summary?: string; title?: string; category?: string } })
      },
      async feed() { return [] },
      async mark() {},
      async deleteSubscriber() {},
      async health() { return { ok: true } },
    })
    const schedule = startClockDriftSchedule({
      poll: false,
      now: () => server,
      ntp: async () => server + 2000,
    })
    const sent = await schedule.tick()
    assert.equal(sent, true)
    const note = triggered.find((row) => row.subscriberId === subscriberId(notificationUserKey({ iss: 'idp', sub: 'admin1' })))
    assert.ok(note)
    assert.equal(note.payload.category, 'security')
    assert.equal(note.payload.title, 'Clock drift')
    assert.match(note.payload.summary ?? '', /2000/)
  })

  it('does not alert when the server clock is 1 second from NTP', async () => {
    const triggered: string[] = []
    useNovu({
      async trigger() { triggered.push('sent') },
      async feed() { return [] },
      async mark() {},
      async deleteSubscriber() {},
      async health() { return { ok: true } },
    })
    const schedule = startClockDriftSchedule({
      poll: false,
      now: () => server,
      ntp: async () => server + 1000,
    })
    assert.equal(await schedule.tick(), false)
    assert.deepEqual(triggered, [])
  })

  it('reads the NTP transmit time as the reference clock', () => {
    const packet = Buffer.alloc(48)
    packet.writeUInt32BE(4002609600, 40)
    assert.equal(ntpTimeFromPacket(packet), Date.UTC(2026, 10, 2, 12, 0, 0))
  })
})

describe('clock drift schedule integ (injectable deps)', () => {
  it('tick notifies injected admins when drift exceeds 1s', async () => {
    const notified: Array<{ summary?: string; recipients?: Array<{ sub: string }> }> = []
    let listed = 0
    const schedule = startClockDriftSchedule({
      poll: false,
      now: () => server,
      ntp: async () => server + 2500,
      listAdmins: async () => {
        listed += 1
        return [{ iss: 'idp', sub: 'injected-admin' }]
      },
      notify: async (event) => {
        notified.push(event)
      },
    })
    assert.equal(await schedule.tick(), true)
    assert.equal(listed, 1)
    assert.equal(notified.length, 1)
    assert.equal(notified[0]?.recipients?.[0]?.sub, 'injected-admin')
    assert.match(notified[0]?.summary ?? '', /2500/)
    schedule.stop()
  })

  it('tick does not notify when drift is within 1s', async () => {
    let notifyCalls = 0
    let listCalls = 0
    const schedule = startClockDriftSchedule({
      poll: false,
      now: () => server,
      ntp: async () => server + 1000,
      listAdmins: async () => {
        listCalls += 1
        return [{ iss: 'idp', sub: 'injected-admin' }]
      },
      notify: async () => {
        notifyCalls += 1
      },
    })
    assert.equal(await schedule.tick(), false)
    assert.equal(listCalls, 0)
    assert.equal(notifyCalls, 0)
    schedule.stop()
  })
})
