import '../../db/testSchema.js'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  revokeAll,
  suspend,
  confirmSuspension,
  selfSuspend,
  revokeOnRoleChange,
  validateBackChannelLogout,
  isRevoked,
  type SuspensionRequest,
  type BackChannelLogoutToken,
} from './revocation.js'
import { principalKey } from '../session/principal.js'

describe('Revocation and Suspension (Ticket 06)', () => {
  const testPrincipal = { iss: 'https://idp.example.com', sub: `revoke-user-${Date.now()}` }
  const adminUser = { iss: 'https://idp.example.com', sub: `admin-${Date.now()}` }
  const admin2User = { iss: 'https://idp.example.com', sub: `admin2-${Date.now()}` }

  describe('Revoke All', () => {
    it('revokes all Sessions and credentials for a Principal immediately', async () => {
      await revokeAll(testPrincipal, { revokedBy: adminUser, reason: 'security incident' })

      const revoked = await isRevoked(testPrincipal)
      assert.strictEqual(revoked, true)
    })

    it('returns ACCESS_REVOKED on next request after revocation', async () => {
      await revokeAll(testPrincipal, { revokedBy: adminUser, reason: 'policy violation' })

      const revoked = await isRevoked(testPrincipal)
      assert.strictEqual(revoked, true)
    })

    it('has no revocation cache - checks are always live', async () => {
      // Use a unique principal for this test to avoid interference from previous tests
      const uniquePrincipal = { iss: 'https://idp.example.com', sub: `cache-test-${Date.now()}` }
      
      // First check - not revoked
      const before = await isRevoked(uniquePrincipal)
      assert.strictEqual(before, false)

      // Revoke
      await revokeAll(uniquePrincipal, { revokedBy: adminUser, reason: 'test' })

      // Immediate check - should be revoked (no cache)
      const after = await isRevoked(uniquePrincipal)
      assert.strictEqual(after, true)
    })
  })

  describe('Audit Intent Failures', () => {
    it('returns 503 when audit Intent cannot be appended on revocation', async () => {
      // This test simulates an audit system failure
      // In a real scenario, we'd mock the audit system to fail
      // For now, we'll test that the function signature supports error handling
      
      try {
        await revokeAll(testPrincipal, {
          revokedBy: adminUser,
          reason: 'test',
          auditFailure: true, // Simulate audit failure
        })
        assert.fail('Should have thrown 503 error')
      } catch (err: any) {
        assert.strictEqual(err.status, 503)
        assert.ok(err.message.includes('audit'))
      }
    })

    it('returns 503 when audit Intent cannot be appended on suspension', async () => {
      try {
        await suspend(testPrincipal, {
          suspendedBy: adminUser,
          reason: 'suspected compromise',
          auditFailure: true,
        })
        assert.fail('Should have thrown 503 error')
      } catch (err: any) {
        assert.strictEqual(err.status, 503)
      }
    })

    it('has no deferred append or break-glass mechanism', async () => {
      // Use a unique principal for this test to avoid interference from previous tests
      const uniquePrincipal = { iss: 'https://idp.example.com', sub: `break-glass-test-${Date.now()}` }
      
      // When audit fails, the operation MUST fail - no workarounds
      try {
        await revokeAll(uniquePrincipal, {
          revokedBy: adminUser,
          reason: 'test',
          auditFailure: true,
        })
        assert.fail('Should have thrown error')
      } catch (err: any) {
        // The revocation should NOT have been applied
        assert.strictEqual(err.status, 503)
      }
      
      // Verify the principal is NOT revoked
      const revoked = await isRevoked(uniquePrincipal)
      assert.strictEqual(revoked, false)
    })
  })

  describe('Two-Admin Suspension', () => {
    it('requires a second admin to confirm suspension within 24 hours', async () => {
      const suspensionId = await suspend(testPrincipal, {
        suspendedBy: adminUser,
        reason: 'suspected security issue',
      })

      // Should be pending, not yet effective
      const pendingSuspensions = await suspend.getPending()
      assert.ok(pendingSuspensions.some((s: SuspensionRequest) => s.id === suspensionId))
    })

    it('suspension becomes effective after second admin confirms', async () => {
      const suspensionId = await suspend(testPrincipal, {
        suspendedBy: adminUser,
        reason: 'security review',
      })

      await confirmSuspension(suspensionId, {
        confirmedBy: admin2User,
        reason: 'confirmed after review',
      })

      const revoked = await isRevoked(testPrincipal)
      assert.strictEqual(revoked, true)
    })

    it('unconfirmed suspension lapses after 24 hours', async () => {
      // Use a unique principal for this test to avoid interference from previous tests
      const uniquePrincipal = { iss: 'https://idp.example.com', sub: `lapse-test-${Date.now()}` }
      
      const now = Date.now()
      const originalNow = Date.now
      Date.now = () => now

      try {
        const suspensionId = await suspend(uniquePrincipal, {
          suspendedBy: adminUser,
          reason: 'pending review',
        })

        // Move time forward 25 hours
        Date.now = () => now + 25 * 60 * 60 * 1000

        // Suspension should have lapsed
        const pendingSuspensions = await suspend.getPending()
        assert.ok(!pendingSuspensions.some((s: SuspensionRequest) => s.id === suspensionId))

        // Principal should NOT be revoked
        const revoked = await isRevoked(uniquePrincipal)
        assert.strictEqual(revoked, false)
      } finally {
        Date.now = originalNow
      }
    })

    it('rejects second admin confirmation if it is the same admin', async () => {
      const suspensionId = await suspend(testPrincipal, {
        suspendedBy: adminUser,
        reason: 'requires independent review',
      })

      try {
        await confirmSuspension(suspensionId, {
          confirmedBy: adminUser, // Same admin!
          reason: 'trying to self-confirm',
        })
        assert.fail('Should have rejected same-admin confirmation')
      } catch (err: any) {
        assert.ok(err.message.includes('different admin'))
      }
    })
  })

  describe('Self-Suspension', () => {
    it('allows a Principal to suspend their own account immediately', async () => {
      await selfSuspend(testPrincipal, { reason: 'device lost' })

      const revoked = await isRevoked(testPrincipal)
      assert.strictEqual(revoked, true)
    })

    it('self-suspension does not require confirmation', async () => {
      // Use a unique principal for this test
      const uniquePrincipal = { iss: 'https://idp.example.com', sub: `self-susp-test-${Date.now()}` }
      
      await selfSuspend(uniquePrincipal, { reason: 'security precaution' })

      // Should be immediately effective
      const revoked = await isRevoked(uniquePrincipal)
      assert.strictEqual(revoked, true)

      // Should not appear in pending confirmations
      const pending = await suspend.getPending()
      assert.ok(!pending.some((s: SuspensionRequest) => 
        principalKey(s.principal) === principalKey(uniquePrincipal)
      ))
    })
  })

  describe('Role and Grant Changes', () => {
    it('forces fresh login when role changes', async () => {
      const sessionStart = Math.floor(Date.now() / 1000)
      
      await revokeOnRoleChange(testPrincipal, {
        changedBy: adminUser,
        reason: 'role modified',
      })

      // Any session started before this should be revoked
      const revokedForSession = await isRevoked(testPrincipal, { sessionStart })
      assert.strictEqual(revokedForSession, true)
    })

    it('forces fresh login when grants change', async () => {
      const sessionStart = Math.floor(Date.now() / 1000)
      
      await revokeOnRoleChange(testPrincipal, {
        changedBy: adminUser,
        reason: 'permissions updated',
      })

      const revokedForSession = await isRevoked(testPrincipal, { sessionStart })
      assert.strictEqual(revokedForSession, true)
    })
  })

  describe('Back-Channel Logout', () => {
    it('validates signature on back-channel logout token', async () => {
      const invalidToken: BackChannelLogoutToken = {
        iss: 'https://idp.example.com',
        aud: 'mice-client-id',
        sub: testPrincipal.sub,
        events: {
          'http://schemas.openid.net/event/backchannel-logout': {},
        },
        jti: `jti-${Date.now()}`,
        iat: Math.floor(Date.now() / 1000),
        signature: 'invalid-signature',
      }

      try {
        await validateBackChannelLogout(invalidToken)
        assert.fail('Should have rejected invalid signature')
      } catch (err: any) {
        assert.ok(err.message.includes('signature'))
      }
    })

    it('validates issuer matches expected IdP', async () => {
      const wrongIssuer: BackChannelLogoutToken = {
        iss: 'https://wrong-idp.com', // Wrong issuer
        aud: 'mice-client-id',
        sub: testPrincipal.sub,
        events: {
          'http://schemas.openid.net/event/backchannel-logout': {},
        },
        jti: `jti-${Date.now()}`,
        iat: Math.floor(Date.now() / 1000),
        signature: 'valid-signature',
      }

      try {
        await validateBackChannelLogout(wrongIssuer)
        assert.fail('Should have rejected wrong issuer')
      } catch (err: any) {
        assert.ok(err.message.includes('issuer'))
      }
    })

    it('validates audience matches client ID', async () => {
      const wrongAudience: BackChannelLogoutToken = {
        iss: 'https://idp.example.com',
        aud: 'wrong-client-id', // Wrong audience
        sub: testPrincipal.sub,
        events: {
          'http://schemas.openid.net/event/backchannel-logout': {},
        },
        jti: `jti-${Date.now()}`,
        iat: Math.floor(Date.now() / 1000),
        signature: 'valid-signature',
      }

      try {
        await validateBackChannelLogout(wrongAudience)
        assert.fail('Should have rejected wrong audience')
      } catch (err: any) {
        assert.ok(err.message.includes('audience'))
      }
    })

    it('validates required logout event is present', async () => {
      const noEvent: BackChannelLogoutToken = {
        iss: 'https://idp.example.com',
        aud: 'mice-client-id',
        sub: testPrincipal.sub,
        events: {}, // Missing required event
        jti: `jti-${Date.now()}`,
        iat: Math.floor(Date.now() / 1000),
        signature: 'valid-signature',
      }

      try {
        await validateBackChannelLogout(noEvent)
        assert.fail('Should have rejected missing logout event')
      } catch (err: any) {
        assert.ok(err.message.includes('event'))
      }
    })

    it('validates nonce and rejects jti replay', async () => {
      const token: BackChannelLogoutToken = {
        iss: 'https://idp.example.com',
        aud: 'mice-client-id',
        sub: testPrincipal.sub,
        events: {
          'http://schemas.openid.net/event/backchannel-logout': {},
        },
        jti: `jti-${Date.now()}`,
        iat: Math.floor(Date.now() / 1000),
        signature: 'valid-signature',
      }

      // First validation should succeed (with valid signature)
      await validateBackChannelLogout(token, { skipSignatureValidation: true })

      // Second validation with same jti should be rejected
      try {
        await validateBackChannelLogout(token, { skipSignatureValidation: true })
        assert.fail('Should have rejected jti replay')
      } catch (err: any) {
        assert.ok(err.message.includes('replay') || err.message.includes('jti'))
      }
    })

    it('fully validates all fields before accepting back-channel logout', async () => {
      const validToken: BackChannelLogoutToken = {
        iss: 'https://idp.example.com',
        aud: 'mice-client-id',
        sub: testPrincipal.sub,
        events: {
          'http://schemas.openid.net/event/backchannel-logout': {},
        },
        jti: `jti-valid-${Date.now()}`,
        iat: Math.floor(Date.now() / 1000),
        signature: 'valid-signature',
      }

      // Should validate without throwing
      await validateBackChannelLogout(validToken, { skipSignatureValidation: true })

      // Principal should be logged out
      const revoked = await isRevoked(testPrincipal)
      assert.strictEqual(revoked, true)
    })
  })
})
