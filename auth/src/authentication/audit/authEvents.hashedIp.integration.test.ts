import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createHash } from 'node:crypto'
import { recordAuthEvent, queryAuthEventsByPrincipal } from './authEvents.js'
import { hashIp } from '../../ipHash.js'

/**
 * Ticket 44 integration: auth audit write path stores hashed_ip (never raw IP).
 * Exercises prepareAuthEventForStore → DB insert → query through recordAuthEvent.
 */

describe('hashed_ip on auth audit write path (Ticket 44)', () => {
  const principal = { iss: 'https://idp.example.com', sub: `hashed-ip-integ-${Date.now()}` }

  it('recordAuthEvent persists hashed_ip matching hashIp for that client address', async () => {
    const clientIp = '203.0.113.44'
    const requestId = 'req-ticket-44-integ'
    await recordAuthEvent({
      type: 'login',
      principal,
      requestId,
      outcome: 'success',
      clientIp,
      token: 'must-not-persist',
      ipAddress: clientIp,
    })

    const events = await queryAuthEventsByPrincipal(principal, {
      month: new Date().toISOString().slice(0, 7),
    })
    const event = events.find((row) => row.requestId === requestId)
    assert.ok(event)
    assert.equal(event.hashedIp, await hashIp(clientIp))
    const raw = JSON.stringify(event)
    assert.equal(raw.includes(clientIp), false)
    assert.equal(raw.includes('must-not-persist'), false)
  })

  it('recordAuthEvent write path uses an injectable hash port', async () => {
    const clientIp = '198.51.100.44'
    const requestId = 'req-ticket-44-hash-port'
    const expected = createHash('sha256').update(`integ:${clientIp}`).digest('hex')
    await recordAuthEvent(
      {
        type: 'logout',
        principal,
        requestId,
        outcome: 'success',
        clientIp,
      },
      {
        hash: async (ip) => {
          assert.equal(ip, clientIp)
          return expected
        },
      },
    )

    const events = await queryAuthEventsByPrincipal(principal, {
      month: new Date().toISOString().slice(0, 7),
    })
    const event = events.find((row) => row.requestId === requestId)
    assert.ok(event)
    assert.equal(event.hashedIp, expected)
    assert.equal(JSON.stringify(event).includes(clientIp), false)
  })

  it('omits hashed_ip when the write path has no client address', async () => {
    const requestId = 'req-ticket-44-no-ip'
    await recordAuthEvent({
      type: 'refresh',
      principal,
      requestId,
      outcome: 'success',
    })
    const events = await queryAuthEventsByPrincipal(principal, {
      month: new Date().toISOString().slice(0, 7),
    })
    const event = events.find((row) => row.requestId === requestId)
    assert.ok(event)
    assert.equal(event.hashedIp, undefined)
  })
})
