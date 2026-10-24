import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from './clock.js'
import { createDeviceAuthorizations, createMemoryDeviceRepository } from './cliDevice.js'

const alice = { sub: 'alice', iss: 'test', email: 'alice@example.com', name: 'Alice' }
const MIN = 60_000

function setup() {
  const clock = fakeClock()
  const repo = createMemoryDeviceRepository()
  let minted = 0
  const devices = createDeviceAuthorizations({
    repo,
    clock,
    config: { webOrigin: 'http://web', remote: 'http://oxen:8080', authHost: 'oxen:8080' },
    mint: () => ({ token: `mice_pat_raw${++minted}`, patId: `pat${minted}` }),
  })
  return { clock, repo, devices }
}

describe('device authorization state machine', () => {
  it('pending → approved → consumed hands the raw token over once and leaves none stored', () => {
    const { clock, repo, devices } = setup()
    const started = devices.start()
    assert.equal(devices.poll(started.device_code).status, 'authorization_pending')
    assert.equal(devices.approve(started.user_code, alice).ok, true)
    clock.advance(5_000)
    const polled = devices.poll(started.device_code)
    assert.equal(polled.status, 'approved')
    if (polled.status !== 'approved') return
    assert.equal(polled.token, 'mice_pat_raw1')
    assert.equal(polled.remote, 'http://oxen:8080')
    assert.equal(devices.lookup(started.user_code)?.status, 'consumed')
    assert.equal(JSON.stringify(repo.read()).includes('mice_pat_raw1'), false)
    clock.advance(5_000)
    assert.deepEqual(devices.poll(started.device_code), { status: 'error', error: 'already_consumed' })
  })

  it('the approved record holds the raw token only until it is consumed', () => {
    const { repo, devices } = setup()
    const started = devices.start()
    devices.approve(started.user_code, alice)
    assert.equal(JSON.stringify(repo.read()).includes('mice_pat_raw1'), true)
  })

  it('a pending device expires after ten minutes', () => {
    const { clock, devices } = setup()
    const started = devices.start()
    clock.advance(10 * MIN)
    assert.equal(devices.poll(started.device_code).status, 'expired_token')
    assert.deepEqual(devices.approve(started.user_code, alice), {
      ok: false,
      error: 'Device code expired',
      status: 400,
    })
  })

  it('throttles polls closer than four seconds, deterministically', () => {
    const { clock, devices } = setup()
    const started = devices.start()
    assert.equal(devices.poll(started.device_code).status, 'authorization_pending')
    clock.advance(3_999)
    assert.deepEqual(devices.poll(started.device_code), { status: 'slow_down', interval: 5 })
    clock.advance(1)
    assert.equal(devices.poll(started.device_code).status, 'authorization_pending')
  })
})
