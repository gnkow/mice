/**
 * Optional live-stack integration: device start → approve (session mint) → poll.
 * Skips when AUTH_URL is unreachable.
 *
 * Run: node --test cli/integration/device-login.test.mjs
 * Env: AUTH_URL (default http://localhost:8080), SESSION_SECRET
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { EncryptJWT } from 'jose'

const AUTH_URL = (process.env.AUTH_URL ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
)
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'dev-only-change-me-boxen-session-secret'

async function authUp() {
  try {
    const res = await fetch(`${AUTH_URL}/healthz`)
    return res.ok
  } catch {
    return false
  }
}

async function sealSessionCookie() {
  const key = createHash('sha256').update(SESSION_SECRET).digest()
  const token = await new EncryptJWT({
    sub: 'cli-integration',
    iss: 'boxen-e2e',
    email: 'cli-integration@boxen.local',
    name: 'CLI Integration',
    id_token: '',
    groups: [],
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .encrypt(key)
  return `boxen_session=${token}`
}

const up = await authUp()

describe('CLI device login against live BFF', { skip: !up }, () => {
  it('start → session approve → poll → whoami → logout', async () => {
    const start = await fetch(`${AUTH_URL}/auth/cli/device/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(start.status, 200)
    const started = await start.json()
    assert.ok(started.device_code)
    assert.match(started.user_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)

    const cookie = await sealSessionCookie()
    const approve = await fetch(`${AUTH_URL}/auth/cli/device/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({ user_code: started.user_code }),
    })
    const approveText = await approve.text()
    assert.equal(approve.status, 200, approveText)

    // Respect poll interval
    await new Promise((r) => setTimeout(r, 4500))

    const poll = await fetch(`${AUTH_URL}/auth/cli/device/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: started.device_code }),
    })
    const pollText = await poll.text()
    assert.equal(poll.status, 200, pollText)
    const body = JSON.parse(pollText)
    assert.equal(body.status, 'approved')
    const token = body.token || body.access_token
    assert.match(token, /^boxen_pat_/)

    const who = await fetch(`${AUTH_URL}/auth/cli/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(who.status, 200)
    const me = await who.json()
    assert.equal(me.user.email, 'cli-integration@boxen.local')

    const api = await fetch(`${AUTH_URL}/api/version`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(api.status, 200)

    const logout = await fetch(`${AUTH_URL}/auth/cli/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    assert.equal(logout.status, 200)

    const denied = await fetch(`${AUTH_URL}/api/version`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(denied.status, 401)
  })
})

describe('CLI device login skip notice', { skip: up }, () => {
  it('skips when auth BFF is down', () => {
    assert.ok(true)
  })
})
