import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'boxen-cli-device-'))
process.env.AUTH_DATA_DIR = dataDir
process.env.PUBLIC_OXEN_REMOTE = 'http://localhost:8080'
process.env.PUBLIC_WEB_ORIGIN = 'http://localhost:5173'
process.env.SESSION_SECRET = 'test-session-secret-for-cli-device'

const {
  approveDevice,
  clearPollThrottle,
  denyDevice,
  lookupDeviceByUserCode,
  pollDevice,
  startDeviceAuth,
} = await import('./cliDevice.js')
const { findPatByToken, resolvePat, revokePatByToken } = await import(
  './tokens.js'
)

const alice = {
  sub: 'alice',
  iss: 'test',
  email: 'alice@example.com',
  name: 'Alice',
}

describe('CLI device auth', () => {
  before(() => {
    clearPollThrottle()
  })

  after(() => {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('start returns RFC8628-shaped payload', () => {
    const started = startDeviceAuth()
    assert.ok(started.device_code.length >= 16)
    assert.match(started.user_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    assert.equal(started.verification_uri, 'http://localhost:5173/cli/device')
    assert.ok(started.verification_uri_complete.includes(started.user_code))
    assert.equal(started.expires_in, 600)
    assert.equal(started.interval, 5)
  })

  it('start → approve → poll returns one-time cli-login PAT', () => {
    clearPollThrottle()
    const started = startDeviceAuth()

    const pending = pollDevice(started.device_code)
    assert.equal(pending.status, 'authorization_pending')

    const approved = approveDevice(started.user_code, alice)
    assert.equal(approved.ok, true)

    clearPollThrottle()
    const polled = pollDevice(started.device_code)
    assert.equal(polled.status, 'approved')
    if (polled.status !== 'approved') return
    assert.match(polled.token, /^boxen_pat_/)
    assert.equal(polled.user.email, alice.email)
    assert.equal(polled.authHost, 'localhost:8080')
    assert.equal(polled.remote, 'http://localhost:8080')

    const meta = findPatByToken(polled.token)
    assert.equal(meta?.source, 'cli-login')
    assert.equal(meta?.label, 'cli-login')

    const user = resolvePat(polled.token)
    assert.ok(user)
    assert.equal(user?.email, alice.email)

    clearPollThrottle()
    const again = pollDevice(started.device_code)
    assert.equal(again.status, 'error')
  })

  it('deny yields access_denied on poll', () => {
    clearPollThrottle()
    const started = startDeviceAuth()
    const denied = denyDevice(started.user_code)
    assert.equal(denied.ok, true)
    clearPollThrottle()
    const polled = pollDevice(started.device_code)
    assert.equal(polled.status, 'access_denied')
  })

  it('lookupDeviceByUserCode is case-insensitive', () => {
    const started = startDeviceAuth()
    const lookup = lookupDeviceByUserCode(started.user_code.toLowerCase())
    assert.ok(lookup)
    assert.equal(lookup?.status, 'pending')
    assert.equal(lookup?.expired, false)
    assert.equal(lookup?.userCode, started.user_code)
  })

  it('lookup returns null for unknown code', () => {
    assert.equal(lookupDeviceByUserCode('ZZZZ-ZZZZ'), null)
  })

  it('approve rejects unknown / already-handled codes', () => {
    const started = startDeviceAuth()
    assert.equal(approveDevice('NOPE-CODE', alice).ok, false)
    assert.equal(approveDevice(started.user_code, alice).ok, true)
    const second = approveDevice(started.user_code, alice)
    assert.equal(second.ok, false)
  })

  it('deny rejects unknown / already-handled codes', () => {
    const started = startDeviceAuth()
    assert.equal(denyDevice('NOPE-CODE').ok, false)
    assert.equal(denyDevice(started.user_code).ok, true)
    assert.equal(denyDevice(started.user_code).ok, false)
  })

  it('poll unknown device_code errors', () => {
    clearPollThrottle()
    const polled = pollDevice('not-a-real-device-code')
    assert.equal(polled.status, 'error')
  })

  it('poll slow_down when polled too quickly', () => {
    clearPollThrottle()
    const started = startDeviceAuth()
    const first = pollDevice(started.device_code)
    assert.equal(first.status, 'authorization_pending')
    const second = pollDevice(started.device_code)
    assert.equal(second.status, 'slow_down')
  })

  it('revokePatByToken invalidates CLI token', () => {
    clearPollThrottle()
    const started = startDeviceAuth()
    approveDevice(started.user_code, alice)
    clearPollThrottle()
    const polled = pollDevice(started.device_code)
    assert.equal(polled.status, 'approved')
    if (polled.status !== 'approved') return
    assert.equal(revokePatByToken(polled.token), true)
    assert.equal(resolvePat(polled.token), null)
  })
})
