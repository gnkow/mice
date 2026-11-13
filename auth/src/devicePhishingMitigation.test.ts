import './db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionUser } from './authentication/session/session.js'
import {
  createDeviceApprovalRateLimit,
  beginDeviceApproval,
} from './authentication/credentials/deviceApprovalRateLimit.js'

/**
 * Device Flow Phishing Mitigation Tests (Ticket 25)
 *
 * Public seam: begin() → commit() — check/record/warning stay behind that interface.
 */

const mkUser = (sub: string): SessionUser => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@test.io`,
  name: sub,
  principalId: 1,
})

async function approve(
  gate: ReturnType<typeof createDeviceApprovalRateLimit>,
  user: SessionUser,
  userCode: string,
  hashedIp: string | null = null,
) {
  const open = await gate.begin(user)
  assert.equal(open.allowed, true, `expected allow for ${userCode}`)
  if (!open.allowed) return null
  return open.commit(userCode, hashedIp)
}

describe('Device Approval Rate Limiting (U15)', () => {
  it('allows first approval within rate limit', async () => {
    const gate = createDeviceApprovalRateLimit()
    const user = mkUser('alice-rl1')
    const open = await gate.begin(user)
    assert.equal(open.allowed, true)
    if (!open.allowed) return
    assert.equal(open.count, 0)
  })

  it('allows up to 5 approvals in 10 minutes', async () => {
    const gate = createDeviceApprovalRateLimit()
    const user = mkUser('bob-rl2')

    for (let i = 1; i <= 5; i++) {
      await approve(gate, user, `CODE${i}`)
    }

    const blocked = await gate.begin(user)
    assert.equal(blocked.allowed, false)
    if (blocked.allowed) return
    assert.equal(blocked.count, 5)
  })

  it('triggers security alert on 5th approval', async () => {
    const gate = createDeviceApprovalRateLimit()
    const user = mkUser('charlie-rl3')

    let alertTriggered = false
    for (let i = 1; i <= 5; i++) {
      const committed = await approve(gate, user, `CODE${i}`)
      if (committed?.shouldAlert) {
        alertTriggered = true
        assert.equal(i, 5)
        assert.ok(committed.securityWarning)
      }
    }
    assert.ok(alertTriggered)
  })

  it('records approver hashed IP for audit trail via commit', async () => {
    const gate = createDeviceApprovalRateLimit()
    const user = mkUser('eve-rl5')
    const hashedIp = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    const committed = await approve(gate, user, 'CODE-HASHED', hashedIp)
    assert.ok(committed)
    assert.equal(committed.count, 1)
  })

  it('rate limit window is 10 minutes', async () => {
    const gate = createDeviceApprovalRateLimit()
    const user = mkUser('frank-rl6')
    for (let i = 1; i <= 5; i++) {
      await approve(gate, user, `CODE${i}`)
    }
    const blocked = await gate.begin(user)
    assert.equal(blocked.allowed, false)
    if (blocked.allowed) return
    assert.equal(blocked.windowMinutes, 10)
  })

  it('different principals have independent rate limits', async () => {
    const gate = createDeviceApprovalRateLimit()
    const alice = mkUser('grace-rl7')
    const bob = mkUser('hank-rl8')
    for (let i = 1; i <= 5; i++) {
      await approve(gate, alice, `ALICE${i}`)
    }
    const bobOpen = await gate.begin(bob)
    assert.equal(bobOpen.allowed, true)
    if (!bobOpen.allowed) return
    assert.equal(bobOpen.count, 0)
  })
})

describe('Device approval rate-limit gate', () => {
  it('begin blocks a sixth approval and commit builds the fifth-approval security warning', async () => {
    const gate = createDeviceApprovalRateLimit()
    const user = mkUser('iris-gate1')

    for (let i = 1; i <= 4; i++) {
      const open = await gate.begin(user)
      assert.equal(open.allowed, true)
      if (!open.allowed) return
      const committed = await open.commit(`G${i}`, null)
      assert.equal(committed.shouldAlert, false)
      assert.equal(committed.securityWarning, null)
    }

    const fifth = await gate.begin(user)
    assert.equal(fifth.allowed, true)
    if (!fifth.allowed) return
    const alerted = await fifth.commit('G5', null)
    assert.equal(alerted.shouldAlert, true)
    assert.equal(alerted.count, 5)
    assert.ok(alerted.securityWarning)
    assert.match(alerted.securityWarning!, /iris-gate1/)
    assert.match(alerted.securityWarning!, /iris-gate1@test\.io/)
    assert.match(alerted.securityWarning!, /Investigation recommended/)

    const sixth = await gate.begin(user)
    assert.equal(sixth.allowed, false)
    if (sixth.allowed) return
    assert.equal(sixth.count, 5)
    assert.equal(sixth.windowMinutes, 10)
  })

  it('beginDeviceApproval uses the live gate', async () => {
    const user = mkUser('live-export-1')
    const open = await beginDeviceApproval(user)
    assert.equal(open.allowed, true)
  })
})
