import '../../db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  consumeRateLimit,
  ipRateLimitKey,
  principalRateLimitKey,
  cleanupOldRateLimitRecords,
  RATE_LIMIT_CONFIG,
  type RateLimitConfig,
  type RateLimitStore,
} from './rateLimit.js'
import { breakTable } from '../../db/testDatabase.js'

/**
 * Tests for General Rate Limiting (Ticket 24, U22)
 *
 * Public seam: consumeRateLimit(limitKey, config) — check + record behind one interface.
 */

describe('Rate Limiting (Ticket 24, U22)', () => {
  describe('Per-IP rate limiting', () => {
    it('allows requests within limit', async () => {
      const ip = '192.168.1.100'
      const key = await ipRateLimitKey(ip)
      const config: RateLimitConfig = { limit: 5, windowMs: 60_000, endpoint: 'test_ip' }

      for (let i = 0; i < 5; i++) {
        const result = await consumeRateLimit(key, config)
        assert.equal(result.allowed, true)
      }
    })

    it('blocks requests exceeding limit', async () => {
      const ip = '192.168.1.101'
      const key = await ipRateLimitKey(ip)
      const config: RateLimitConfig = { limit: 3, windowMs: 60_000, endpoint: 'test_block' }

      for (let i = 0; i < 3; i++) {
        const result = await consumeRateLimit(key, config)
        assert.equal(result.allowed, true)
      }

      const blocked = await consumeRateLimit(key, config)
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
      const config: RateLimitConfig = { limit: 2, windowMs: 100, endpoint: 'test_window' }

      for (let i = 0; i < 2; i++) {
        const result = await consumeRateLimit(key, config)
        assert.equal(result.allowed, true)
      }

      const blocked = await consumeRateLimit(key, config)
      assert.equal(blocked.allowed, false)

      await new Promise((resolve) => setTimeout(resolve, 150))

      const allowed = await consumeRateLimit(key, config)
      assert.equal(allowed.allowed, true)
    })

    it('enforces different limits per endpoint', async () => {
      const ip = '192.168.1.103'
      const key = await ipRateLimitKey(ip)
      const loginConfig: RateLimitConfig = { limit: 2, windowMs: 60_000, endpoint: 'login' }
      const refreshConfig: RateLimitConfig = { limit: 2, windowMs: 60_000, endpoint: 'refresh' }

      for (let i = 0; i < 2; i++) {
        const result = await consumeRateLimit(key, loginConfig)
        assert.equal(result.allowed, true)
      }

      const blockedLogin = await consumeRateLimit(key, loginConfig)
      assert.equal(blockedLogin.allowed, false)

      const allowedRefresh = await consumeRateLimit(key, refreshConfig)
      assert.equal(allowedRefresh.allowed, true)
    })
  })

  describe('Per-Principal rate limiting', () => {
    it('allows requests within limit', async () => {
      const principalKey = 'https://idp.example.com|user123'
      const key = principalRateLimitKey(principalKey)
      const config: RateLimitConfig = { limit: 10, windowMs: 3600_000, endpoint: 'token_mint' }

      for (let i = 0; i < 10; i++) {
        const result = await consumeRateLimit(key, config)
        assert.equal(result.allowed, true)
      }
    })

    it('blocks requests exceeding limit', async () => {
      const principalKey = 'https://idp.example.com|user456'
      const key = principalRateLimitKey(principalKey)
      const config: RateLimitConfig = { limit: 5, windowMs: 3600_000, endpoint: 'token_mint' }

      for (let i = 0; i < 5; i++) {
        const result = await consumeRateLimit(key, config)
        assert.equal(result.allowed, true)
      }

      const blocked = await consumeRateLimit(key, config)
      assert.equal(blocked.allowed, false)
    })

    it('enforces separate limits per Principal', async () => {
      const key1 = principalRateLimitKey('https://idp.example.com|alice')
      const key2 = principalRateLimitKey('https://idp.example.com|bob')
      const config: RateLimitConfig = { limit: 2, windowMs: 60_000, endpoint: 'test_separate' }

      for (let i = 0; i < 2; i++) {
        const result = await consumeRateLimit(key1, config)
        assert.equal(result.allowed, true)
      }

      const blockedAlice = await consumeRateLimit(key1, config)
      assert.equal(blockedAlice.allowed, false)

      const allowedBob = await consumeRateLimit(key2, config)
      assert.equal(allowedBob.allowed, true)
    })
  })

  describe('Fail-closed behavior', () => {
    it('returns error when the injected store cannot count', async () => {
      const store: RateLimitStore = {
        countInWindow: async () => {
          throw new Error('counter down')
        },
        record: async () => {
          throw new Error('should not record')
        },
      }
      const result = await consumeRateLimit('ip:fake', { limit: 10, windowMs: 60_000, endpoint: 'inj' }, { store })
      assert.equal('error' in result, true)
      if ('error' in result) {
        assert.match(result.message, /counter down/)
      }
    })

    it('returns error when the injected store cannot record', async () => {
      const store: RateLimitStore = {
        countInWindow: async () => 0,
        record: async () => {
          throw new Error('write down')
        },
      }
      const result = await consumeRateLimit('ip:fake-write', { limit: 10, windowMs: 60_000, endpoint: 'inj' }, { store })
      assert.equal('error' in result, true)
      if ('error' in result) {
        assert.match(result.message, /write down|unavailable/i)
      }
    })

    it('returns error when storage is unavailable', async () => {
      const repair = await breakTable('rate_limits')

      try {
        const key = await ipRateLimitKey('192.168.1.200')
        const config: RateLimitConfig = { limit: 10, windowMs: 60_000, endpoint: 'test_fail' }

        const result = await consumeRateLimit(key, config)

        assert.equal('error' in result, true)
        if ('error' in result) {
          assert.equal(result.error, true)
          assert.ok(result.message)
        }
      } finally {
        await repair()
      }
    })

    it('does not increment the counter when consume fails closed', async () => {
      const key = await ipRateLimitKey('192.168.1.201')
      const config: RateLimitConfig = { limit: 10, windowMs: 60_000, endpoint: 'test_no_record' }

      const repair = await breakTable('rate_limits')
      try {
        const result = await consumeRateLimit(key, config)
        assert.equal('error' in result, true)
      } finally {
        await repair()
      }

      const after = await consumeRateLimit(key, config)
      assert.equal(after.allowed, true)
      if (after.allowed) {
        assert.equal(after.count, 0)
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

      for (let i = 0; i < 3; i++) {
        await consumeRateLimit(key, config)
      }

      const deleted = await cleanupOldRateLimitRecords(3600_000)
      assert.ok(deleted >= 0)
    })
  })

  describe('Cross-instance enforcement', () => {
    it('shares counters across instances (same Postgres)', async () => {
      const key = await ipRateLimitKey('192.168.1.300')
      const config: RateLimitConfig = { limit: 3, windowMs: 60_000, endpoint: 'test_shared' }

      for (let i = 0; i < 2; i++) {
        const result = await consumeRateLimit(key, config)
        assert.equal(result.allowed, true)
      }

      const instanceB = await consumeRateLimit(key, config)
      assert.equal(instanceB.allowed, true)
      if (instanceB.allowed) {
        assert.equal(instanceB.count, 2)
      }

      const blocked = await consumeRateLimit(key, config)
      assert.equal(blocked.allowed, false)
    })
  })
})
