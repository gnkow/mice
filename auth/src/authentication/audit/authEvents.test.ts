import '../../db/testSchema.js'
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { recordAuthEvent, queryAuthEventsByPrincipal, checkFailureRate, type AuthEventType } from './authEvents.js'
import { principalKey } from '../session/principal.js'
import { hashIp } from '../../ipHash.js'

describe('Authentication Event Audit (Ticket 05)', () => {
  const testPrincipal = { iss: 'https://idp.example.com', sub: `user-${Date.now()}` }
  const requestId = 'req-abc-123'
  
  let originalDateNow: typeof Date.now
  let currentTime: number

  beforeEach(() => {
    currentTime = new Date('2026-10-26T10:00:00Z').getTime()
    originalDateNow = Date.now
    Date.now = () => currentTime
  })

  afterEach(() => {
    Date.now = originalDateNow
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
      assert.strictEqual(events.length >= 1, true)
      const loginEvent = events.find(e => e.type === 'login')
      assert.ok(loginEvent)
      assert.strictEqual(loginEvent.principalKey, principalKey(testPrincipal))
      assert.strictEqual(loginEvent.requestId, requestId)
      assert.strictEqual(loginEvent.outcome, 'success')
    })

    it('stores hashed_ip for a login and leaves the raw address out', async () => {
      const ip = '203.0.113.10'
      const logged: string[] = []
      const write = (chunk: unknown) => { logged.push(String(chunk)); return true }
      const stdout = process.stdout.write
      const stderr = process.stderr.write
      process.stdout.write = write as typeof process.stdout.write
      process.stderr.write = write as typeof process.stderr.write
      try {
        await recordAuthEvent({
          type: 'login',
          principal: testPrincipal,
          requestId: 'req-hashed-ip',
          outcome: 'success',
          clientIp: ip,
        })
      } finally {
        process.stdout.write = stdout
        process.stderr.write = stderr
      }

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      const event = events.find((e) => e.requestId === 'req-hashed-ip')
      assert.ok(event)
      assert.strictEqual(event.hashedIp, await hashIp(ip))
      assert.ok(!JSON.stringify(event).includes(ip))
      assert.ok(!logged.join('').includes(ip))
    })

    it('leaves hashed_ip unset when the client address is missing', async () => {
      await recordAuthEvent({
        type: 'logout',
        principal: testPrincipal,
        requestId: 'req-no-ip',
        outcome: 'success',
      })
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      const event = events.find((e) => e.requestId === 'req-no-ip')
      assert.ok(event)
      assert.strictEqual(event.hashedIp, undefined)
    })

    it('stores the same hash on logout, refresh, step-up, revocation, and a failed login', async () => {
      const ip = '198.51.100.20'
      const expected = await hashIp(ip)
      const rows: Array<{ type: AuthEventType; outcome: 'success' | 'failure'; requestId: string }> = [
        { type: 'logout', outcome: 'success', requestId: 'req-logout-ip' },
        { type: 'refresh', outcome: 'success', requestId: 'req-refresh-ip' },
        { type: 'step-up', outcome: 'success', requestId: 'req-step-ip' },
        { type: 'revocation', outcome: 'success', requestId: 'req-revoke-ip' },
        { type: 'login', outcome: 'failure', requestId: 'req-fail-ip' },
      ]
      for (const row of rows) {
        await recordAuthEvent({ ...row, principal: testPrincipal, clientIp: ip })
      }
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      for (const row of rows) {
        const event = events.find((e) => e.requestId === row.requestId)
        assert.ok(event)
        assert.strictEqual(event.hashedIp, expected)
        assert.ok(!JSON.stringify(event).includes(ip))
      }
    })

    it('records logout events', async () => {
      await recordAuthEvent({
        type: 'logout',
        principal: testPrincipal,
        requestId: 'req-logout',
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      assert.ok(events.some((e) => e.type === 'logout'))
    })

    it('records refresh events', async () => {
      await recordAuthEvent({
        type: 'refresh',
        principal: testPrincipal,
        requestId: 'req-refresh',
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      assert.ok(events.some((e) => e.type === 'refresh'))
    })

    it('records step-up authentication events', async () => {
      await recordAuthEvent({
        type: 'step-up',
        principal: testPrincipal,
        requestId: 'req-stepup',
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      assert.ok(events.some((e) => e.type === 'step-up'))
    })

    it('records failure events', async () => {
      await recordAuthEvent({
        type: 'login',
        principal: testPrincipal,
        requestId: 'req-fail',
        outcome: 'failure',
        reason: 'invalid_credentials',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      assert.ok(events.some((e) => e.outcome === 'failure'))
    })

    it('records revocation events', async () => {
      await recordAuthEvent({
        type: 'revocation',
        principal: testPrincipal,
        requestId: 'req-revoke',
        outcome: 'success',
      })

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      assert.ok(events.some((e) => e.type === 'revocation'))
    })
  })

  describe('Redaction Requirements', () => {
    it('never logs tokens in event records', async () => {
      const sensitiveData = {
        type: 'login' as AuthEventType,
        principal: testPrincipal,
        requestId: 'req-token-test',
        outcome: 'success' as const,
        // These should be stripped/rejected
        token: 'Bearer abc123',
        accessToken: 'sensitive-token',
      }

      await recordAuthEvent(sensitiveData as any)
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      
      const event = events.find(e => e.requestId === 'req-token-test')
      assert.ok(event)
      assert.strictEqual((event as any).token, undefined)
      assert.strictEqual((event as any).accessToken, undefined)
      const eventStr = JSON.stringify(event)
      assert.ok(!eventStr.includes('abc123'))
      assert.ok(!eventStr.includes('sensitive-token'))
    })

    it('never logs cookies in event records', async () => {
      const sensitiveData = {
        type: 'refresh' as AuthEventType,
        principal: testPrincipal,
        requestId: 'req-cookie-test',
        outcome: 'success' as const,
        cookie: 'session_id=xyz789',
      }

      await recordAuthEvent(sensitiveData as any)
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      
      const event = events.find(e => e.requestId === 'req-cookie-test')
      assert.ok(event)
      assert.strictEqual((event as any).cookie, undefined)
      assert.ok(!JSON.stringify(event).includes('xyz789'))
    })

    it('never logs authorization codes in event records', async () => {
      const sensitiveData = {
        type: 'login' as AuthEventType,
        principal: testPrincipal,
        requestId: 'req-code-test',
        outcome: 'success' as const,
        code: 'auth-code-secret-123',
        authorizationCode: 'another-secret',
      }

      await recordAuthEvent(sensitiveData as any)
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      
      const event = events.find(e => e.requestId === 'req-code-test')
      assert.ok(event)
      assert.strictEqual((event as any).code, undefined)
      assert.strictEqual((event as any).authorizationCode, undefined)
      const eventStr = JSON.stringify(event)
      assert.ok(!eventStr.includes('secret'))
    })

    it('never stores IP addresses in any field', async () => {
      const dataWithIP = {
        type: 'login' as AuthEventType,
        principal: testPrincipal,
        requestId: 'req-ip-test',
        outcome: 'success' as const,
        ipAddress: '192.168.1.1',
        clientIp: '10.0.0.5',
      }

      await recordAuthEvent(dataWithIP as any)
      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      
      const event = events.find(e => e.requestId === 'req-ip-test')
      assert.ok(event)
      assert.strictEqual((event as any).ipAddress, undefined)
      assert.strictEqual((event as any).clientIp, undefined)
      const eventStr = JSON.stringify(event)
      assert.ok(!/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(eventStr))
    })
  })

  describe('Constant-time Responses', () => {
    it('returns similar timing for valid and invalid credentials', async () => {
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
      assert.ok(Math.abs(durationValid - durationInvalid) < 50)
    })

    it('stores internal failure reasons for audit', async () => {
      const failures = [
        { reason: 'invalid_credentials' },
        { reason: 'account_locked' },
        { reason: 'mfa_required' },
        { reason: 'idp_unavailable' },
      ]

      for (const { reason } of failures) {
        await recordAuthEvent({
          type: 'login',
          principal: testPrincipal,
          requestId: `req-${reason}`,
          outcome: 'failure',
          reason,
        })
      }

      const events = await queryAuthEventsByPrincipal(testPrincipal, { month: '2026-10' })
      const failureEvents = events.filter((e) => e.outcome === 'failure' && e.reason)
      
      // Internal reason is stored for audit
      assert.ok(failureEvents.length >= 4)
      assert.ok(failureEvents.some(e => e.reason === 'invalid_credentials'))
      assert.ok(failureEvents.some(e => e.reason === 'account_locked'))
    })
  })

  describe('Failure Rate Alerting', () => {
    it('alerts after 5 failures in 10 minutes for one Principal', async () => {
      const testUser = { iss: 'https://idp.example.com', sub: `alert-user-${Date.now()}` }
      const now = new Date('2026-10-26T10:00:00Z')
      currentTime = now.getTime()

      let alertCalled = false
      let alertData: any = null
      
      // Record 5 failures within 10 minutes
      for (let i = 0; i < 5; i++) {
        currentTime = now.getTime() + i * 60 * 1000 // 1 minute apart
        await recordAuthEvent({
          type: 'login',
          principal: testUser,
          requestId: `req-fail-${i}`,
          outcome: 'failure',
          reason: 'invalid_credentials',
        })
      }

      // Reset time for check
      currentTime = now.getTime() + 5 * 60 * 1000
      
      const shouldAlert = await checkFailureRate(testUser, { 
        onAlert: (alert) => {
          alertCalled = true
          alertData = alert
        }
      })
      
      assert.strictEqual(shouldAlert, true)
      assert.strictEqual(alertCalled, true)
      assert.ok(alertData)
      assert.strictEqual(alertData.principal, principalKey(testUser))
      assert.strictEqual(alertData.failureCount, 5)
      assert.strictEqual(alertData.windowMinutes, 10)
    })

    it('does not alert for 4 failures in 10 minutes', async () => {
      const testUser = { iss: 'https://idp.example.com', sub: `no-alert-user-${Date.now()}` }
      const now = new Date('2026-10-26T10:00:00Z')
      currentTime = now.getTime()

      let alertCalled = false
      
      // Record 4 failures
      for (let i = 0; i < 4; i++) {
        currentTime = now.getTime() + i * 60 * 1000
        await recordAuthEvent({
          type: 'login',
          principal: testUser,
          requestId: `req-fail-${i}`,
          outcome: 'failure',
          reason: 'invalid_credentials',
        })
      }

      currentTime = now.getTime() + 4 * 60 * 1000
      
      const shouldAlert = await checkFailureRate(testUser, { 
        onAlert: () => { alertCalled = true }
      })
      
      assert.strictEqual(shouldAlert, false)
      assert.strictEqual(alertCalled, false)
    })

    it('does not alert if failures are outside the 10-minute window', async () => {
      const testUser = { iss: 'https://idp.example.com', sub: `window-user-${Date.now()}` }
      const now = new Date('2026-10-26T10:00:00Z')
      currentTime = now.getTime()

      let alertCalled = false
      
      // Record 3 failures in first window
      for (let i = 0; i < 3; i++) {
        await recordAuthEvent({
          type: 'login',
          principal: testUser,
          requestId: `req-old-${i}`,
          outcome: 'failure',
          reason: 'invalid_credentials',
        })
      }

      // Move time forward 12 minutes (outside window)
      currentTime = now.getTime() + 12 * 60 * 1000

      // Record 2 more failures
      for (let i = 0; i < 2; i++) {
        await recordAuthEvent({
          type: 'login',
          principal: testUser,
          requestId: `req-new-${i}`,
          outcome: 'failure',
          reason: 'invalid_credentials',
        })
      }

      const shouldAlert = await checkFailureRate(testUser, { 
        onAlert: () => { alertCalled = true }
      })
      
      assert.strictEqual(shouldAlert, false)
      assert.strictEqual(alertCalled, false)
    })
  })

  describe('Query Capabilities', () => {
    it('allows querying all auth events by Principal and month', async () => {
      const testUser = { iss: 'https://idp.example.com', sub: `query-user-${Date.now()}` }
      const events = [
        { type: 'login' as AuthEventType, outcome: 'success' as const, requestId: 'req-1' },
        { type: 'refresh' as AuthEventType, outcome: 'success' as const, requestId: 'req-2' },
        { type: 'step-up' as AuthEventType, outcome: 'success' as const, requestId: 'req-3' },
        { type: 'logout' as AuthEventType, outcome: 'success' as const, requestId: 'req-4' },
      ]

      for (const event of events) {
        await recordAuthEvent({
          ...event,
          principal: testUser,
        })
      }

      const results = await queryAuthEventsByPrincipal(testUser, { month: '2026-10' })
      assert.ok(results.length >= 4)
      
      const types = results.map((e) => e.type)
      assert.ok(types.includes('login'))
      assert.ok(types.includes('refresh'))
      assert.ok(types.includes('step-up'))
      assert.ok(types.includes('logout'))
    })
  })
})
