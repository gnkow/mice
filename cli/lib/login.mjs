import { bffFetch } from './api.mjs'
import {
  authHostFromRemote,
  clearLoginState,
  loadConfig,
  resolveRemote,
  resolveToken,
  saveConfig,
  saveCredentials,
} from './config.mjs'
import { openBrowser } from './open.mjs'
import { findOxen, oxenConfigAuth, oxenConfigUser } from './oxen.mjs'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {{ remote?: string, open?: boolean }} [opts]
 */
export async function cmdLogin(opts = {}) {
  const remote = resolveRemote({ remote: opts.remote })
  const open = opts.open !== false

  if (!findOxen()) {
    console.error(
      'mice: oxen CLI not found on PATH. Install Oxen first, then retry login.',
    )
    process.exitCode = 1
    return
  }

  const started = await bffFetch(remote, '/auth/cli/device/start', {
    method: 'POST',
    body: {},
  })
  if (!started.res.ok || !started.json?.device_code) {
    console.error(
      `mice login: failed to start device auth (${started.res.status})`,
      started.json?.error ?? started.text,
    )
    process.exitCode = 1
    return
  }

  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri_complete: verifyUrl,
    interval = 5,
    expires_in: expiresIn = 600,
  } = started.json

  console.log('')
  console.log('To authorize this CLI, open:')
  console.log(`  ${verifyUrl}`)
  console.log('')
  console.log(`Confirm code: ${userCode}`)
  console.log('')

  if (open) {
    const opened = openBrowser(verifyUrl)
    if (!opened) {
      console.log('(Could not open a browser — open the URL manually.)')
    }
  }

  const deadline = Date.now() + expiresIn * 1000
  let waitSec = Number(interval) || 5

  while (Date.now() < deadline) {
    await sleep(waitSec * 1000)
    const polled = await bffFetch(remote, '/auth/cli/device/poll', {
      method: 'POST',
      body: { device_code: deviceCode },
    })
    const body = polled.json ?? {}
    const status = body.status

    if (status === 'approved' && (body.token || body.access_token)) {
      const token = body.token || body.access_token
      const authHost = body.auth_host || authHostFromRemote(remote)
      const patId = body.pat_id
      const user = body.user ?? {}

      oxenConfigAuth(authHost, token)
      if (user.name || user.email) {
        oxenConfigUser(user.name ?? '', user.email ?? '')
      }

      saveCredentials({
        token,
        remote,
        authHost,
        patId,
      })
      saveConfig({
        ...loadConfig(),
        remote,
        authHost,
        patId,
        loggedInAt: new Date().toISOString(),
      })

      console.log(`Logged in as ${user.email || user.name || user.sub || 'user'}`)
      console.log(`Remote: ${remote}`)
      return
    }

    if (status === 'authorization_pending') continue
    if (status === 'slow_down') {
      waitSec = Number(body.interval) || waitSec + 5
      continue
    }
    if (status === 'access_denied') {
      console.error('mice login: authorization denied in the browser.')
      process.exitCode = 1
      return
    }
    if (status === 'expired_token') {
      console.error('mice login: device code expired. Run mice login again.')
      process.exitCode = 1
      return
    }

    console.error(
      'mice login: unexpected response',
      body.error ?? body.status ?? polled.text,
    )
    process.exitCode = 1
    return
  }

  console.error('mice login: timed out waiting for approval.')
  process.exitCode = 1
}

/**
 * @param {{ remote?: string }} [opts]
 */
export async function cmdLogout(opts = {}) {
  const remote = resolveRemote({ remote: opts.remote })
  const token = resolveToken()
  if (token) {
    const res = await bffFetch(remote, '/auth/cli/logout', {
      method: 'POST',
      token,
      body: {},
    })
    if (!res.res.ok && res.res.status !== 404) {
      console.error(
        `mice logout: server revoke failed (${res.res.status})`,
        res.json?.error ?? res.text,
      )
    }
  }
  clearLoginState()
  console.log('Logged out.')
}

/**
 * @param {{ remote?: string }} [opts]
 */
export async function cmdWhoami(opts = {}) {
  const remote = resolveRemote({ remote: opts.remote })
  const token = resolveToken()
  if (!token) {
    console.error('Not logged in. Run: mice login')
    process.exitCode = 1
    return
  }
  const res = await bffFetch(remote, '/auth/cli/whoami', { token })
  if (!res.res.ok) {
    console.error(
      `mice whoami: ${res.res.status}`,
      res.json?.error ?? res.text,
    )
    process.exitCode = 1
    return
  }
  const data = res.json
  const u = data.user ?? {}
  console.log(`${u.name || '(no name)'} <${u.email || 'no-email'}>`)
  console.log(`sub: ${u.sub}`)
  if (data.authz) {
    console.log(
      `authz: enforce=${data.authz.enforce} pending=${data.authz.pending} admin=${data.authz.instanceAdmin}`,
    )
  }
  console.log(`remote: ${data.remote ?? remote}`)
}
