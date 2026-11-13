import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadEnv } from '../../env.js'
import { checkSigningIdleTimeout, evaluateSigningIdle } from './idleTimeout.js'

/**
 * Idle Timeout at Signing Tests (Ticket 20)
 *
 * Round 8 decision U2: 15-minute idle timeout enforced at signing ceremony.
 *
 * Related:
 * - .scratch/authentication/issues/20-idle-timeout-at-signing.md
 */

describe('Idle Timeout at Signing (U2)', () => {
  const nowSec = () => Math.floor(Date.now() / 1000)

  it('default idle timeout is 15 minutes (900 seconds)', () => {
    const config = loadEnv({})
    assert.equal(config.sessionIdleSec, 900)
  })

  it('refuses signing when session idle exceeds sessionIdleSec', () => {
    const now = nowSec()
    const decision = evaluateSigningIdle({
      lastActive: now - 16 * 60,
      sessionIdleSec: 900,
      nowSec: now,
    })
    assert.equal(decision.allowed, false)
    if (decision.allowed) return
    assert.equal(decision.maxIdleSec, 900)
    assert.ok(decision.idleSec > 900)
    assert.match(decision.message, /re-authenticate/)

    const response = checkSigningIdleTimeout(
      { lastActive: now - 16 * 60 },
      900,
      now,
    )
    assert.ok(response)
    assert.equal(response.status, 401)
  })

  it('allows signing when last activity is inside the window', () => {
    const now = nowSec()
    const decision = evaluateSigningIdle({
      lastActive: now - 5 * 60,
      sessionIdleSec: 900,
      nowSec: now,
    })
    assert.equal(decision.allowed, true)
    assert.equal(checkSigningIdleTimeout({ lastActive: now - 5 * 60 }, 900, now), null)
  })

  it('idle boundary: 14 minutes allowed, 16 minutes refused', () => {
    const now = nowSec()
    assert.equal(
      evaluateSigningIdle({
        lastActive: now - 14 * 60,
        sessionIdleSec: 900,
        nowSec: now,
      }).allowed,
      true,
    )
    assert.equal(
      evaluateSigningIdle({
        lastActive: now - 16 * 60,
        sessionIdleSec: 900,
        nowSec: now,
      }).allowed,
      false,
    )
  })

  it('idle timeout disabled when sessionIdleSec = 0', () => {
    const now = nowSec()
    assert.equal(loadEnv({ SESSION_IDLE_SEC: '0' }).sessionIdleSec, 0)
    assert.equal(
      evaluateSigningIdle({
        lastActive: now - 60 * 60,
        sessionIdleSec: 0,
        nowSec: now,
      }).allowed,
      true,
    )
  })

  it('skips the check when lastActive is absent', () => {
    assert.equal(
      evaluateSigningIdle({
        lastActive: undefined,
        sessionIdleSec: 900,
        nowSec: nowSec(),
      }).allowed,
      true,
    )
  })
})
