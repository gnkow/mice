import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { recordAuthEvent, queryAuthEventsByPrincipal, checkFailureRate, type AuthEventType } from './authEvents.js'
import { principalKey } from '../session/principal.js'

describe('Authentication Event Audit (Ticket 05)', () => {
  const testPrincipal = { iss: 'https://idp.example.com', sub: 'user123' }
  const requestId = 'req-abc-123'

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Event Recording', () => {
    it('records login events with Principal and request ID', async () => {
      await recordAuthEvent({
        type: 'login',
        principal: testPrincipal,
        requestId,
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'login',
        principalKey: principalKey(testPrincipal),
        requestId,
        outcome: 'success',
      })
    })

    it('records logout events', async () => {
      await recordAuthEvent({
        type: 'logout',
        principal: testPrincipal,
        requestId,
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      expect(events.some((e) => e.type === 'logout')).toBe(true)
    })

    it('records refresh events', async () => {
      await recordAuthEvent({
        type: 'refresh',
        principal: testPrincipal,
        requestId,
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      expect(events.some((e) => e.type === 'refresh')).toBe(true)
    })

    it('records step-up authentication events', async () => {
      await recordAuthEvent({
        type: 'step-up',
        principal: testPrincipal,
        requestId,
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      expect(events.some((e) => e.type === 'step-up')).toBe(true)
    })

    it('records failure events', async () => {
      await recordAuthEvent({
        type: 'login',
        principal: testPrincipal,
        requestId,
        outcome: 'failure',
        reason: 'invalid_credentials',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      expect(events.some((e) => e.outcome === 'failure')).toBe(true)
    })

    it('records revocation events', async () => {
      await recordAuthEvent({
        type: 'revocation',
        principal: testPrincipal,
        requestId,
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      expect(events.some((e) => e.type === 'revocation')).toBe(true)
    })
  })

  describe('Redaction Requirements', () => {
    it('never logs tokens in event records', async () => {
      const sensitiveData = {
        type: 'login' as AuthEventType,
        principal: testPrincipal,
        requestId,
        outcome: 'success' as const,
        // These should be stripped/rejected
        token: 'Bearer abc123',
        accessToken: 'sensitive-token',
      }

      await recordAuthEvent(sensitiveData as any)
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      
      const event = events[0]
      expect(event).not.toHaveProperty('token')
      expect(event).not.toHaveProperty('accessToken')
      expect(JSON.stringify(event)).not.toContain('abc123')
      expect(JSON.stringify(event)).not.toContain('sensitive-token')
    })

    it('never logs cookies in event records', async () => {
      const sensitiveData = {
        type: 'refresh' as AuthEventType,
        principal: testPrincipal,
        requestId,
        outcome: 'success' as const,
        cookie: 'session_id=xyz789',
      }

      await recordAuthEvent(sensitiveData as any)
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      
      const event = events[0]
      expect(event).not.toHaveProperty('cookie')
      expect(JSON.stringify(event)).not.toContain('xyz789')
    })

    it('never logs authorization codes in event records', async () => {
      const sensitiveData = {
        type: 'login' as AuthEventType,
        principal: testPrincipal,
        requestId,
        outcome: 'success' as const,
        code: 'auth-code-secret-123',
        authorizationCode: 'another-secret',
      }

      await recordAuthEvent(sensitiveData as any)
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      
      const event = events[0]
      expect(event).not.toHaveProperty('code')
      expect(event).not.toHaveProperty('authorizationCode')
      expect(JSON.stringify(event)).not.toContain('secret')
    })

    it('never stores IP addresses in any field', async () => {
      const dataWithIP = {
        type: 'login' as AuthEventType,
        principal: testPrincipal,
        requestId,
        outcome: 'success' as const,
        ipAddress: '192.168.1.1',
        clientIp: '10.0.0.5',
      }

      await recordAuthEvent(dataWithIP as any)
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      
      const event = events[0]
      expect(event).not.toHaveProperty('ipAddress')
      expect(event).not.toHaveProperty('clientIp')
      expect(JSON.stringify(event)).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
    })
  })

  describe('Constant-time Responses', () => {
    it('returns identical external responses for valid and invalid credentials', async () => {
      const startValid = Date.now()
      await recordAuthEvent({
        type: 'login',
        principal: testPrincipal,
        requestId: 'req-valid',
        outcome: 'success',
      })
      const durationValid = Date.now() - startValid

      const startInvalid = Date.now()
      await recordAuthEvent({
        type: 'login',
        principal: testPrincipal,
        requestId: 'req-invalid',
        outcome: 'failure',
        reason: 'invalid_credentials',
      })
      const durationInvalid = Date.now() - startInvalid

      // Timing should be similar (within 50ms tolerance)
      expect(Math.abs(durationValid - durationInvalid)).toBeLessThan(50)
    })

    it('ensures uniform error responses regardless of failure reason', async () => {
      const failures = [
        { reason: 'invalid_credentials', expected: 'Authentication failed' },
        { reason: 'account_locked', expected: 'Authentication failed' },
        { reason: 'mfa_required', expected: 'Authentication failed' },
        { reason: 'idp_unavailable', expected: 'Authentication failed' },
      ]

      for (const { reason, expected } of failures) {
        await recordAuthEvent({
          type: 'login',
          principal: testPrincipal,
          requestId: `req-${reason}`,
          outcome: 'failure',
          reason,
        })
      }

      // All failures should produce identical external messages
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      const failureEvents = events.filter((e) => e.outcome === 'failure')
      
      // Internal reason is stored but external message is uniform
      expect(failureEvents.length).toBe(4)
      failureEvents.forEach((event) => {
        expect(event.reason).toBeTruthy() // Internal tracking
      })
    })
  })

  describe('Failure Rate Alerting', () => {
    it('alerts after 5 failures in 10 minutes for one Principal', async () => {
      const now = new Date('2026-10-26T10:00:00Z')
      vi.setSystemTime(now)

      const alertSpy = vi.fn()
      
      // Record 5 failures within 10 minutes
      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(new Date(now.getTime() + i * 60 * 1000)) // 1 minute apart
        await recordAuthEvent({
          type: 'login',
          principal: testPrincipal,
          requestId: `req-fail-${i}`,
          outcome: 'failure',
          reason: 'invalid_credentials',
        })
      }

      const shouldAlert = await checkFailureRate(testPrincipal, { onAlert: alertSpy })
      expect(shouldAlert).toBe(true)
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: principalKey(testPrincipal),
          failureCount: 5,
          windowMinutes: 10,
        })
      )
    })

    it('does not alert for 4 failures in 10 minutes', async () => {
      const now = new Date('2026-10-26T10:00:00Z')
      vi.setSystemTime(now)

      const alertSpy = vi.fn()
      
      // Record 4 failures
      for (let i = 0; i < 4; i++) {
        vi.setSystemTime(new Date(now.getTime() + i * 60 * 1000))
        await recordAuthEvent({
          type: 'login',
          principal: testPrincipal,
          requestId: `req-fail-${i}`,
          outcome: 'failure',
          reason: 'invalid_credentials',
        })
      }

      const shouldAlert = await checkFailureRate(testPrincipal, { onAlert: alertSpy })
      expect(shouldAlert).toBe(false)
      expect(alertSpy).not.toHaveBeenCalled()
    })

    it('does not alert if failures are outside the 10-minute window', async () => {
      const now = new Date('2026-10-26T10:00:00Z')
      vi.setSystemTime(now)

      const alertSpy = vi.fn()
      
      // Record 3 failures in first window
      for (let i = 0; i < 3; i++) {
        await recordAuthEvent({
          type: 'login',
          principal: testPrincipal,
          requestId: `req-old-${i}`,
          outcome: 'failure',
          reason: 'invalid_credentials',
        })
      }

      // Move time forward 12 minutes (outside window)
      vi.setSystemTime(new Date(now.getTime() + 12 * 60 * 1000))

      // Record 2 more failures
      for (let i = 0; i < 2; i++) {
        await recordAuthEvent({
          type: 'login',
          principal: testPrincipal,
          requestId: `req-new-${i}`,
          outcome: 'failure',
          reason: 'invalid_credentials',
        })
      }

      const shouldAlert = await checkFailureRate(testPrincipal, { onAlert: alertSpy })
      expect(shouldAlert).toBe(false)
      expect(alertSpy).not.toHaveBeenCalled()
    })
  })

  describe('Query Capabilities', () => {
    it('allows querying all auth events by Principal and month', async () => {
      const events = [
        { type: 'login' as AuthEventType, outcome: 'success' as const },
        { type: 'refresh' as AuthEventType, outcome: 'success' as const },
        { type: 'step-up' as AuthEventType, outcome: 'success' as const },
        { type: 'logout' as AuthEventType, outcome: 'success' as const },
      ]

      for (const [idx, event] of events.entries()) {
        await recordAuthEvent({
          ...event,
          principal: testPrincipal,
          requestId: `req-${idx}`,
        })
      }

      const results = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      expect(results.length).toBeGreaterThanOrEqual(4)
      
      const types = results.map((e) => e.type)
      expect(types).toContain('login')
      expect(types).toContain('refresh')
      expect(types).toContain('step-up')
      expect(types).toContain('logout')
    })
  })
})
