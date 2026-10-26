import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-cli-device-'))
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

await describe('CLI device auth', async () => {
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

  await it('start returns RFC8628-shaped payload', async () => {
    const started = await startDeviceAuth()
    assert.ok(started.device_code.length >= 16)
    assert.match(started.user_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    assert.equal(started.verification_uri, 'http://localhost:5173/cli/device')
    assert.ok(started.verification_uri_complete.includes(started.user_code))
    assert.equal(started.expires_in, 600)
    assert.equal(started.interval, 5)
  })

  await it('start → approve → poll returns one-time cli-login PAT', async () => {
    clearPollThrottle()
    const started = await startDeviceAuth()

    const pending = await pollDevice(started.device_code)
    assert.equal(pending.status, 'authorization_pending')

    const approved = await approveDevice(started.user_code, alice)
    assert.equal(approved.ok, true)

    clearPollThrottle()
    const polled = await pollDevice(started.device_code)
    assert.equal(polled.status, 'approved')
    if (polled.status !== 'approved') return
    assert.match(polled.token, /^mice_pat_/)
    assert.equal(polled.user.email, alice.email)
    assert.equal(polled.authHost, 'localhost:8080')
    assert.equal(polled.remote, 'http://localhost:8080')

    const meta = await findPatByToken(polled.token)
    assert.equal(meta?.source, 'cli-login')
    assert.equal(meta?.label, 'cli-login')

    const user = await resolvePat(polled.token)
    assert.ok(user)
    assert.equal(user?.email, alice.email)

    clearPollThrottle()
    const again = await pollDevice(started.device_code)
    assert.equal(again.status, 'error')
  })

  await it('deny yields access_denied on poll', async () => {
    clearPollThrottle()
    const started = await startDeviceAuth()
    const denied = await denyDevice(started.user_code)
    assert.equal(denied.ok, true)
    clearPollThrottle()
    const polled = await pollDevice(started.device_code)
    assert.equal(polled.status, 'access_denied')
  })

  await it('lookupDeviceByUserCode is case-insensitive', async () => {
    const started = await startDeviceAuth()
    const lookup = await lookupDeviceByUserCode(started.user_code.toLowerCase())
    assert.ok(lookup)
    assert.equal(lookup?.status, 'pending')
    assert.equal(lookup?.expired, false)
    assert.equal(lookup?.userCode, started.user_code)
  })

  await it('lookup returns null for unknown code', async () => {
    assert.equal(await lookupDeviceByUserCode('ZZZZ-ZZZZ'), null)
  })

  await it('approve rejects unknown / already-handled codes', async () => {
    const started = await startDeviceAuth()
    assert.equal((await approveDevice('NOPE-CODE', alice)).ok, false)
    assert.equal((await approveDevice(started.user_code, alice)).ok, true)
    const second = await approveDevice(started.user_code, alice)
    assert.equal(second.ok, false)
  })

  await it('deny rejects unknown / already-handled codes', async () => {
    const started = await startDeviceAuth()
    assert.equal((await denyDevice('NOPE-CODE')).ok, false)
    assert.equal((await denyDevice(started.user_code)).ok, true)
    assert.equal((await denyDevice(started.user_code)).ok, false)
  })

  await it('poll unknown device_code errors', async () => {
    clearPollThrottle()
    const polled = await pollDevice('not-a-real-device-code')
    assert.equal(polled.status, 'error')
  })

  await it('poll slow_down when polled too quickly', async () => {
    clearPollThrottle()
    const started = await startDeviceAuth()
    const first = await pollDevice(started.device_code)
    assert.equal(first.status, 'authorization_pending')
    const second = await pollDevice(started.device_code)
    assert.equal(second.status, 'slow_down')
  })

  await it('revokePatByToken invalidates CLI token', async () => {
    clearPollThrottle()
    const started = await startDeviceAuth()
    await approveDevice(started.user_code, alice)
    clearPollThrottle()
    const polled = await pollDevice(started.device_code)
    assert.equal(polled.status, 'approved')
    if (polled.status !== 'approved') return
    assert.equal(await revokePatByToken(polled.token), true)
    assert.equal(await resolvePat(polled.token), null)
  })

  await it('mints a scoped PAT when the CLI asked for scopes and shows them to the approver', async () => {
    clearPollThrottle()
    const scopes = [{ namespace: 'lab', repo: 'data', maxRole: 'read' as const }]
    const started = await startDeviceAuth(scopes)
    assert.deepEqual((await lookupDeviceByUserCode(started.user_code))?.scopes, scopes)
    await approveDevice(started.user_code, alice)
    clearPollThrottle()
    const polled = await pollDevice(started.device_code)
    assert.equal(polled.status, 'approved')
    if (polled.status !== 'approved') return
    assert.deepEqual((await resolvePat(polled.token))?.patScopes, scopes)
  })
})
