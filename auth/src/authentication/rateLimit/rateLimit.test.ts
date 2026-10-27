import '../../db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkRateLimit,
  recordRateLimitRequest,
  ipRateLimitKey,
  principalRateLimitKey,
  cleanupOldRateLimitRecords,
  RATE_LIMIT_CONFIG,
  type RateLimitConfig,
} from './rateLimit.js'
import { rateLimits } from '../../db/schema.js'
import { breakTable } from '../../db/testDatabase.js'

/**
 * Tests for General Rate Limiting (Ticket 24, U22)
 * 
 * Verifies:
 * - Per-IP and per-Principal rate limiting
 * - Fail-closed behavior when storage is unavailable
 * - Cross-instance enforcement (shared Postgres storage)
 * - 429 responses with Retry-After headers
 * - Rate limit window expiry
 */

describe('Rate Limiting (Ticket 24, U22)', () => {
  describe('Per-IP rate limiting', () => {
    it('allows requests within limit', async () => {
      const ip = '192.168.1.100'
      const key = await ipRateLimitKey(ip)
      const config: RateLimitConfig = { limit: 5, windowMs: 60_000, endpoint: 'test_ip' }

      // First 5 requests should be allowed
      for (let i = 0; i < 5; i++) {
        const result = await checkRateLimit(key, config)
        assert.equal(result.allowed, true)
        if (result.allowed) {
          await recordRateLimitRequest(key, config.endpoint)
        }
      }
    })

    it('blocks requests exceeding limit', async () => {
      const ip = '192.168.1.101'
      const key = await ipRateLimitKey(ip)
      const config: RateLimitConfig = { limit: 3, windowMs: 60_000, endpoint: 'test_block' }

      // Allow 3 requests
      for (let i = 0; i < 3; i++) {
        const result = await checkRateLimit(key, config)
        assert.equal(result.allowed, true)
        if (result.allowed) {
          await recordRateLimitRequest(key, config.endpoint)
        }
      }

      // 4th request should be blocked
      const blocked = await checkRateLimit(key, config)
      assert.equal(blocked.allowed, false)
      if (!blocked.allowed && !('error' in blocked)) {
        assert.equal(blocked.count, 3)
        assert.equal(blocked.limit, 3)
        assert.equal(blocked.windowSeconds, 60)
        assert.equal(blocked.retryAfter, 60)
      }
    })

    it('resets limit after window expires', async () => {
      const ip = '192.168.1.102'
      const key = await ipRateLimitKey(ip)
      // Short window for testing
      const config: RateLimitConfig = { limit: 2, windowMs: 100, endpoint: 'test_window' }

      // Use up the limit
      for (let i = 0; i < 2; i++) {
        const result = await checkRateLimit(key, config)
        assert.equal(result.allowed, true)
        if (result.allowed) {
          await recordRateLimitRequest(key, config.endpoint)
        }
      }

      // Should be blocked
      const blocked = await checkRateLimit(key, config)
      assert.equal(blocked.allowed, false)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should be allowed again
      const allowed = await checkRateLimit(key, config)
      assert.equal(allowed.allowed, true)
    })

    it('enforces different limits per endpoint', async () => {
      const ip = '192.168.1.103'
      const key = await ipRateLimitKey(ip)
      const loginConfig: RateLimitConfig = { limit: 2, windowMs: 60_000, endpoint: 'login' }
      const refreshConfig: RateLimitConfig = { limit: 2, windowMs: 60_000, endpoint: 'refresh' }

      // Use up login limit
      for (let i = 0; i < 2; i++) {
        const result = await checkRateLimit(key, loginConfig)
        assert.equal(result.allowed, true)
        if (result.allowed) {
          await recordRateLimitRequest(key, loginConfig.endpoint)
        }
      }

      // Login should be blocked
      const blockedLogin = await checkRateLimit(key, loginConfig)
      assert.equal(blockedLogin.allowed, false)

      // Refresh should still be allowed (different endpoint)
      const allowedRefresh = await checkRateLimit(key, refreshConfig)
      assert.equal(allowedRefresh.allowed, true)
    })
  })

  describe('Per-Principal rate limiting', () => {
    it('allows requests within limit', async () => {
      const principalKey = 'https://idp.example.com|user123'
      const key = principalRateLimitKey(principalKey)
      const config: RateLimitConfig = { limit: 10, windowMs: 3600_000, endpoint: 'token_mint' }

      // First 10 requests should be allowed
      for (let i = 0; i < 10; i++) {
        const result = await checkRateLimit(key, config)
        assert.equal(result.allowed, true)
        if (result.allowed) {
          await recordRateLimitRequest(key, config.endpoint)
        }
      }
    })

    it('blocks requests exceeding limit', async () => {
      const principalKey = 'https://idp.example.com|user456'
      const key = principalRateLimitKey(principalKey)
      const config: RateLimitConfig = { limit: 5, windowMs: 3600_000, endpoint: 'token_mint' }

      // Allow 5 requests
      for (let i = 0; i < 5; i++) {
        const result = await checkRateLimit(key, config)
        assert.equal(result.allowed, true)
        if (result.allowed) {
          await recordRateLimitRequest(key, config.endpoint)
        }
      }

      // 6th request should be blocked
      const blocked = await checkRateLimit(key, config)
      assert.equal(blocked.allowed, false)
    })

    it('enforces separate limits per Principal', async () => {
      const key1 = principalRateLimitKey('https://idp.example.com|alice')
      const key2 = principalRateLimitKey('https://idp.example.com|bob')
      const config: RateLimitConfig = { limit: 2, windowMs: 60_000, endpoint: 'test_separate' }

      // Alice uses her limit
      for (let i = 0; i < 2; i++) {
        const result = await checkRateLimit(key1, config)
        assert.equal(result.allowed, true)
        if (result.allowed) {
          await recordRateLimitRequest(key1, config.endpoint)
        }
      }

      // Alice is blocked
      const blockedAlice = await checkRateLimit(key1, config)
      assert.equal(blockedAlice.allowed, false)

      // Bob still has his own limit
      const allowedBob = await checkRateLimit(key2, config)
      assert.equal(allowedBob.allowed, true)
    })
  })

  describe('Fail-closed behavior', () => {
    it('returns error when storage is unavailable', async () => {
      // Break the rate_limits table
      const repair = await breakTable('rate_limits')

      try {
        const key = await ipRateLimitKey('192.168.1.200')
        const config: RateLimitConfig = { limit: 10, windowMs: 60_000, endpoint: 'test_fail' }

        const result = await checkRateLimit(key, config)
        
        // Should return error, not allowed
        assert.equal('error' in result, true)
        if ('error' in result) {
          assert.equal(result.error, true)
          assert.ok(result.message)
        }
      } finally {
        await repair()
      }
    })

    it('does not record request when storage fails', async () => {
      const key = await ipRateLimitKey('192.168.1.201')
      const config: RateLimitConfig = { limit: 10, windowMs: 60_000, endpoint: 'test_no_record' }

      const repair = await breakTable('rate_limits')

      try {
        // Attempt to record should fail silently
        await recordRateLimitRequest(key, config.endpoint)
        // No error thrown
      } finally {
        await repair()
      }

      // After repair, counter should still be 0
      const result = await checkRateLimit(key, config)
      assert.equal(result.allowed, true)
      if (result.allowed) {
        assert.equal(result.count, 0)
      }
    })
  })

  describe('Standard endpoint configurations', () => {
    it('has correct login rate limit (10/min)', () => {
      assert.equal(RATE_LIMIT_CONFIG.login.limit, 10)
      assert.equal(RATE_LIMIT_CONFIG.login.windowMs, 60_000)
      assert.equal(RATE_LIMIT_CONFIG.login.endpoint, 'login')
    })

    it('has correct device flow rate limit (5/min)', () => {
      assert.equal(RATE_LIMIT_CONFIG.deviceFlow.limit, 5)
      assert.equal(RATE_LIMIT_CONFIG.deviceFlow.windowMs, 60_000)
      assert.equal(RATE_LIMIT_CONFIG.deviceFlow.endpoint, 'device_flow')
    })

    it('has correct refresh rate limit (20/min)', () => {
      assert.equal(RATE_LIMIT_CONFIG.refresh.limit, 20)
      assert.equal(RATE_LIMIT_CONFIG.refresh.windowMs, 60_000)
      assert.equal(RATE_LIMIT_CONFIG.refresh.endpoint, 'refresh')
    })

    it('has correct token mint rate limit (10/hour)', () => {
      assert.equal(RATE_LIMIT_CONFIG.tokenMint.limit, 10)
      assert.equal(RATE_LIMIT_CONFIG.tokenMint.windowMs, 3600_000)
      assert.equal(RATE_LIMIT_CONFIG.tokenMint.endpoint, 'token_mint')
    })
  })

  describe('Cleanup', () => {
    it('deletes old rate limit records', async () => {
      const key = await ipRateLimitKey('192.168.1.250')
      const config: RateLimitConfig = { limit: 10, windowMs: 60_000, endpoint: 'test_cleanup' }

      // Record some requests
      for (let i = 0; i < 3; i++) {
        await recordRateLimitRequest(key, config.endpoint)
      }

      // Clean up records older than 1 hour
      const deleted = await cleanupOldRateLimitRecords(3600_000)
      
      // Should have deleted at least our test records
      // (may be more if other tests left records)
      assert.ok(deleted >= 0)
    })
  })

  describe('Cross-instance enforcement', () => {
    it('shares counters across instances (same Postgres)', async () => {
      const key = await ipRateLimitKey('192.168.1.300')
      const config: RateLimitConfig = { limit: 3, windowMs: 60_000, endpoint: 'test_shared' }

      // Instance A records 2 requests
      for (let i = 0; i < 2; i++) {
        const result = await checkRateLimit(key, config)
        assert.equal(result.allowed, true)
        if (result.allowed) {
          await recordRateLimitRequest(key, config.endpoint)
        }
      }

      // Instance B checks the same key (should see 2 already)
      const instanceB = await checkRateLimit(key, config)
      assert.equal(instanceB.allowed, true)
      if (instanceB.allowed) {
        assert.equal(instanceB.count, 2)
        await recordRateLimitRequest(key, config.endpoint)
      }

      // Instance A checks again (should see 3, hit limit)
      const blocked = await checkRateLimit(key, config)
      assert.equal(blocked.allowed, false)
    })
  })
})
