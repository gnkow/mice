import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Override with BOXEN_CONFIG_DIR (tests / custom installs). */
function resolveConfigDir() {
  const fromEnv = process.env.BOXEN_CONFIG_DIR?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return join(homedir(), '.config', 'boxen')
}

function paths() {
  const dir = resolveConfigDir()
  return {
    dir,
    config: join(dir, 'config.json'),
    creds: join(dir, 'credentials.json'),
  }
}

/**
 * @typedef {{
 *   remote?: string
 *   authHost?: string
 *   patId?: string
 *   loggedInAt?: string
 * }} BoxenConfig
 */

/**
 * @typedef {{
 *   token?: string
 *   remote?: string
 *   authHost?: string
 *   patId?: string
 * }} BoxenCredentials
 */

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(path, data) {
  mkdirSync(paths().dir, { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function configDir() {
  return paths().dir
}

/** @returns {BoxenConfig} */
export function loadConfig() {
  return readJson(paths().config, {})
}

/** @param {BoxenConfig} cfg */
export function saveConfig(cfg) {
  writeJson(paths().config, cfg)
}

/** @returns {BoxenCredentials} */
export function loadCredentials() {
  return readJson(paths().creds, {})
}

/** @param {BoxenCredentials} creds */
export function saveCredentials(creds) {
  const { creds: credsPath } = paths()
  writeJson(credsPath, creds)
  try {
    chmodSync(credsPath, 0o600)
  } catch {
    /* windows / unsupported */
  }
}

export function clearCredentials() {
  writeJson(paths().creds, {})
}

export function clearLoginState() {
  const cfg = loadConfig()
  delete cfg.patId
  delete cfg.loggedInAt
  saveConfig(cfg)
  clearCredentials()
}

/**
 * Resolve BFF remote base URL (no trailing slash).
 * @param {{ remote?: string }} [opts]
 */
export function resolveRemote(opts = {}) {
  const fromEnv = process.env.BOXEN_REMOTE?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (opts.remote) return opts.remote.replace(/\/$/, '')
  const cfg = loadConfig()
  if (cfg.remote) return cfg.remote.replace(/\/$/, '')
  return 'http://localhost:8080'
}

export function authHostFromRemote(remote) {
  try {
    return new URL(remote).host
  } catch {
    return remote.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
}

/** Token for API calls: BOXEN_PAT env, else stored credentials. */
export function resolveToken() {
  if (process.env.BOXEN_PAT?.trim()) return process.env.BOXEN_PAT.trim()
  const creds = loadCredentials()
  return creds.token?.trim() || null
}
