import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from '../../clock.js'
import { createDeviceAuthorizations, createPostgresDeviceRepository } from './cliDevice.js'

const alice = { sub: 'alice', iss: 'test', email: 'alice@example.com', name: 'Alice' }
const MIN = 60_000

function setup() {
  const clock = fakeClock()
  const repo = createPostgresDeviceRepository()
  let minted = 0
  const devices = createDeviceAuthorizations({
    repo,
    clock,
    config: { webOrigin: 'http://web', remote: 'http://oxen:8080', authHost: 'oxen:8080' },
    mint: async () => ({
      token: `mice_cli_raw${++minted}`,
      refreshToken: `refresh${minted}`,
      expiresIn: 8 * 60 * 60,
    }),
    discard: async () => {},
  })
  return { clock, repo, devices }
}

await describe('device authorization state machine', async () => {
  await it('pending → approved → consumed hands the raw token over once and leaves none stored', async () => {
    const { clock, repo, devices } = setup()
    const started = await devices.start()
    assert.equal((await devices.poll(started.device_code)).status, 'authorization_pending')
    assert.equal((await devices.approve(started.user_code, alice)).ok, true)
    clock.advance(5_000)
    const polled = await devices.poll(started.device_code)
    assert.equal(polled.status, 'approved')
    if (polled.status !== 'approved') return
    assert.equal(polled.token, 'mice_cli_raw1')
    assert.equal(polled.remote, 'http://oxen:8080')
    assert.equal((await devices.lookup(started.user_code))?.status, 'consumed')
    assert.equal(JSON.stringify(await repo.findByUserCode(started.user_code)).includes('mice_cli_raw1'), false)
    clock.advance(5_000)
    assert.deepEqual(await devices.poll(started.device_code), { status: 'error', error: 'already_consumed' })
  })

  await it('the approved record holds the raw token only until it is consumed', async () => {
    const { repo, devices } = setup()
    const started = await devices.start()
    await devices.approve(started.user_code, alice)
    assert.equal(JSON.stringify(await repo.findByUserCode(started.user_code)).includes('mice_cli_raw1'), true)
  })

  await it('a pending device expires after ten minutes', async () => {
    const { clock, devices } = setup()
    const started = await devices.start()
    clock.advance(10 * MIN)
    assert.equal((await devices.poll(started.device_code)).status, 'expired_token')
    assert.deepEqual(await devices.approve(started.user_code, alice), {
      ok: false,
      error: 'Device code expired',
      status: 400,
    })
  })

  await it('throttles polls closer than four seconds, deterministically', async () => {
    const { clock, devices } = setup()
    const started = await devices.start()
    assert.equal((await devices.poll(started.device_code)).status, 'authorization_pending')
    clock.advance(3_999)
    assert.deepEqual(await devices.poll(started.device_code), { status: 'slow_down', interval: 5 })
    clock.advance(1)
    assert.equal((await devices.poll(started.device_code)).status, 'authorization_pending')
  })
})
