/**
 * Optional live-stack integration: device start → approve (session mint) → poll.
 * Skips when AUTH_URL is unreachable.
 *
 * Run: node --test cli/integration/device-login.test.mjs
 * Env: AUTH_URL (default http://localhost:8080), SESSION_SECRET
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const AUTH_URL = (process.env.AUTH_URL ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
)

async function authUp() {
  try {
    const res = await fetch(`${AUTH_URL}/healthz`)
    return res.ok
  } catch {
    return false
  }
}

function cookieJar() {
  const cookies = new Map()
  return {
    store(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const pair = line.split(';', 1)[0]
        const eq = pair.indexOf('=')
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
      }
    },
    header() {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
    },
  }
}

/** Signs in through the live IdP and returns the BFF session cookie. */
async function browserSession(username, password) {
  const jar = cookieJar()
  let next = `${AUTH_URL}/auth/login`
  let res = await fetch(next, { redirect: 'manual' })
  for (let hop = 0; hop < 8; hop++) {
    jar.store(res)
    if (res.status < 300 || res.status >= 400) break
    next = new URL(res.headers.get('location'), next).toString()
    res = await fetch(next, { redirect: 'manual', headers: { cookie: jar.header() } })
  }
  const html = await res.text()
  const action = html.match(/action="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&')
  if (!action) throw new Error('IdP login form was not found')
  res = await fetch(action, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: jar.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  })
  for (let hop = 0; hop < 8; hop++) {
    jar.store(res)
    if (res.status < 300 || res.status >= 400) break
    next = new URL(res.headers.get('location'), res.url || action).toString()
    res = await fetch(next, { redirect: 'manual', headers: { cookie: jar.header() } })
  }
  const session = [...jar.header().split('; ')].find((part) => part.startsWith('__Host-mice_session='))
  if (!session) throw new Error('login did not set a session cookie')
  return session
}

async function sessionPrincipal(cookie) {
  const res = await fetch(`${AUTH_URL}/auth/me`, { headers: { Cookie: cookie } })
  const text = await res.text()
  assert.equal(res.status, 200, text)
  const body = JSON.parse(text)
  const principal = body.user ?? body
  assert.ok(principal?.sub && principal?.iss)
  return principal
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

    // Admin cannot approve devices (S25). Warm the Manager principal, then grant Manager role.
    const manageWarm = await browserSession('mice_manage', 'manage123')
    const manager = await sessionPrincipal(manageWarm)
    const adminCookie = await browserSession('mice_admin', 'admin123')
    const grant = await fetch(`${AUTH_URL}/auth/grants/role`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: AUTH_URL,
        Cookie: adminCookie,
        'X-Mice-Reason': 'CLI device-login integration test',
      },
      body: JSON.stringify({
        sub: manager.sub,
        iss: manager.iss,
        role: 'manager',
        expiresAt: Date.now() + 86_400_000,
        reason: 'CLI device-login integration test',
      }),
    })
    assert.equal(grant.status, 200, await grant.text())

    const manageCookie = await browserSession('mice_manage', 'manage123')
    const approve = await fetch(`${AUTH_URL}/auth/cli/device/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: AUTH_URL,
        Cookie: manageCookie,
      },
      body: JSON.stringify({ user_code: started.user_code, confirmation: 'APPROVE' }),
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
    assert.match(token, /^mice_cli_/)

    const who = await fetch(`${AUTH_URL}/auth/cli/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(who.status, 200)
    const me = await who.json()
    assert.equal(me.user.email, 'mice_manage@mice.com')

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
