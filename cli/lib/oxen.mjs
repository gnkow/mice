import { spawn, spawnSync } from 'node:child_process'
import {
  authHostFromRemote,
  resolveRemote,
  resolveToken,
} from './config.mjs'

/** @returns {string | null} */
export function findOxen() {
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [
    'oxen',
  ], {
    encoding: 'utf8',
  })
  if (which.status === 0) {
    const line = which.stdout.trim().split(/\r?\n/)[0]
    return line || null
  }
  return null
}

export function oxenVersion() {
  const bin = findOxen()
  if (!bin) return null
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  if (r.status !== 0) return null
  return (r.stdout || r.stderr || '').trim() || null
}

/**
 * Configure oxen auth for the BFF host with a PAT.
 * @param {string} authHost
 * @param {string} token
 */
export function oxenConfigAuth(authHost, token) {
  const bin = findOxen()
  if (!bin) throw new Error('oxen CLI not found on PATH')
  const r = spawnSync(bin, ['config', '--auth', authHost, token], {
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    throw new Error(
      (r.stderr || r.stdout || `oxen config --auth failed (${r.status})`).trim(),
    )
  }
}

/**
 * @param {string} name
 * @param {string} email
 */
export function oxenConfigUser(name, email) {
  const bin = findOxen()
  if (!bin) return
  if (name) {
    spawnSync(bin, ['config', '--name', name], { encoding: 'utf8' })
  }
  if (email) {
    spawnSync(bin, ['config', '--email', email], { encoding: 'utf8' })
  }
}

/**
 * True if URL host:port looks like the raw oxen-server publish port.
 * @param {string} urlOrHost
 */
export function looksLikeDirectOxenServer(urlOrHost) {
  try {
    const u = urlOrHost.includes('://')
      ? new URL(urlOrHost)
      : new URL(`http://${urlOrHost}`)
    return u.port === '3001' || u.host.endsWith(':3001')
  } catch {
    return /:3001\b/.test(urlOrHost)
  }
}

/**
 * Rewrite argv URLs that target :3001 to the configured BFF remote.
 * @param {string[]} args
 * @param {string} bffRemote
 * @returns {{ args: string[], rewritten: boolean, blocked?: string }}
 */
export function rewriteArgsForBff(args, bffRemote) {
  const remote = bffRemote.replace(/\/$/, '')
  let rewritten = false
  /** @type {string | undefined} */
  let blocked
  const next = args.map((arg) => {
    if (!/^https?:\/\//i.test(arg)) return arg
    if (!looksLikeDirectOxenServer(arg)) return arg
    try {
      const u = new URL(arg)
      const bff = new URL(remote)
      // Preserve path (/ns/repo) on the BFF host
      const path = u.pathname + u.search + u.hash
      rewritten = true
      return `${bff.origin}${path === '/' ? '' : path}`
    } catch {
      blocked = arg
      return arg
    }
  })
  return { args: next, rewritten, blocked }
}

/**
 * Ensure oxen auth is configured for the BFF before passthrough.
 * @param {string} [remote]
 */
export function ensureOxenAuth(remote) {
  const r = resolveRemote({ remote })
  const host = authHostFromRemote(r)
  const token = resolveToken()
  if (!token) {
    throw new Error(
      `Not logged in for ${host}. Run: boxen login\n(Or set BOXEN_PAT for automation.)`,
    )
  }
  oxenConfigAuth(host, token)
  return { remote: r, authHost: host, token }
}

/**
 * Spawn oxen with argv; inherit stdio; resolve with exit code.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export function runOxen(args) {
  const bin = findOxen()
  if (!bin) {
    console.error(
      'boxen: oxen CLI not found on PATH.\nInstall Oxen (https://docs.oxen.ai), then run: boxen login',
    )
    return Promise.resolve(127)
  }
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: 'inherit' })
    child.on('error', (err) => {
      console.error(`boxen: failed to run oxen: ${err.message}`)
      resolve(127)
    })
    child.on('close', (code, signal) => {
      if (signal) resolve(1)
      else resolve(code ?? 1)
    })
  })
}
