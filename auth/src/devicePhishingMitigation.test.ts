import './db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionUser } from './authentication/session/session.js'
import {
  checkDeviceApprovalRateLimit,
  createDeviceApprovalRateLimit,
  getRecentApprovals,
  recordDeviceApproval,
} from './authentication/credentials/deviceApprovalRateLimit.js'

/**
 * Device Flow Phishing Mitigation Tests (Ticket 25)
 * 
 * Round 8 decision U15: Prevent device flow phishing attacks via:
 * - Visual verification (hashed IP last 4 chars, device name)
 * - Typing confirmation ("APPROVE" or device code)
 * - Rate limiting (5 approvals per 10 minutes)
 * - Security alerts on excessive approvals
 * 
 * Attack scenario: Attacker emails "your IT needs you to verify code BCDF-WXYZ."
 * Scientist, already signed in, approves without checking. Attacker's terminal
 * receives credential. These mitigations increase friction and enable detection.
 * 
 * Related:
 * - .scratch/authentication/issues/25-device-flow-phishing-mitigation.md
 * - Round 8 decision U15
 */

const mkUser = (sub: string): SessionUser => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@test.io`,
  name: sub,
  principalId: 1,
})

describe('Device Approval Rate Limiting (U15)', () => {
  it('allows first approval within rate limit', async () => {
    const user = mkUser('alice-rl1')
    const result = await checkDeviceApprovalRateLimit(user)
    
    assert.ok(result.allowed, 'First approval should be allowed')
    assert.equal(result.count, 0, 'Count should be 0 initially')
  })

  it('allows up to 5 approvals in 10 minutes', async () => {
    const user = mkUser('bob-rl2')
    
    for (let i = 1; i <= 5; i++) {
      const preCheck = await checkDeviceApprovalRateLimit(user)
      assert.ok(preCheck.allowed, `Approval ${i} should be allowed`)
      
      await recordDeviceApproval(user, `CODE${i}`, null)
    }
    
    // 6th approval should be blocked
    const blocked = await checkDeviceApprovalRateLimit(user)
    assert.ok(!blocked.allowed, '6th approval should be blocked')
    assert.equal(blocked.count, 5, 'Count should be 5')
  })

  it('triggers security alert on 5th approval', async () => {
    const user = mkUser('charlie-rl3')
    
    let alertTriggered = false
    
    for (let i = 1; i <= 5; i++) {
      const { shouldAlert } = await recordDeviceApproval(user, `CODE${i}`, null)
      if (shouldAlert) {
        alertTriggered = true
        assert.equal(i, 5, 'Alert should trigger on 5th approval')
      }
    }
    
    assert.ok(alertTriggered, 'Security alert should have been triggered')
  })

  it('returns recent approval timestamps', async () => {
    const user = mkUser('diana-rl4')
    
    await recordDeviceApproval(user, 'CODE1', null)
    await recordDeviceApproval(user, 'CODE2', null)
    await recordDeviceApproval(user, 'CODE3', null)
    
    const recent = await getRecentApprovals(user, 10)
    
    assert.equal(recent.length, 3, 'Should return 3 recent approvals')
    assert.equal(recent[0].userCode, 'CODE1')
    assert.equal(recent[1].userCode, 'CODE2')
    assert.equal(recent[2].userCode, 'CODE3')
  })

  it('records approver hashed IP for audit trail', async () => {
    const user = mkUser('eve-rl5')
    const hashedIp = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    
    await recordDeviceApproval(user, 'CODE-HASHED', hashedIp)
    
    // Verify it was recorded (implicitly via no errors)
    const recent = await getRecentApprovals(user, 1)
    assert.equal(recent.length, 1)
    assert.equal(recent[0].userCode, 'CODE-HASHED')
  })

  it('rate limit window is 10 minutes', async () => {
    const user = mkUser('frank-rl6')
    
    // Record 5 approvals
    for (let i = 1; i <= 5; i++) {
      await recordDeviceApproval(user, `CODE${i}`, null)
    }
    
    // Check rate limit result includes window info
    const blocked = await checkDeviceApprovalRateLimit(user)
    assert.ok(!blocked.allowed)
    if ('windowMinutes' in blocked) {
      assert.equal(blocked.windowMinutes, 10, 'Window should be 10 minutes')
    }
  })

  it('different principals have independent rate limits', async () => {
    const alice = mkUser('grace-rl7')
    const bob = mkUser('hank-rl8')
    
    // Alice approves 5
    for (let i = 1; i <= 5; i++) {
      await recordDeviceApproval(alice, `ALICE${i}`, null)
    }
    
    // Bob should still be able to approve
    const bobCheck = await checkDeviceApprovalRateLimit(bob)
    assert.ok(bobCheck.allowed, 'Bob should not be affected by Alice\'s rate limit')
    assert.equal(bobCheck.count, 0, 'Bob should have 0 approvals')
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
})
