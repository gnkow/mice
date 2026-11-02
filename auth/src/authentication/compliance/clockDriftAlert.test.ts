import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-clock-drift-'))
process.env.SESSION_SECRET = 'test-session-secret-for-clock-drift'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'

const { ntpTimeFromPacket, startClockDriftSchedule } = await import('./clockDriftAlert.js')
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
