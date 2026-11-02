import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { credentialFor, keychain } from './keychain.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Override with MICE_CONFIG_DIR (tests / custom installs). */
function resolveConfigDir() {
  const fromEnv = process.env.MICE_CONFIG_DIR?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return join(homedir(), '.config', 'mice')
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
 *   loggedInAt?: string
 * }} MiceConfig
 */

/**
 * @typedef {{
 *   token?: string
 *   remote?: string
 *   authHost?: string
 * }} MiceCredentials
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

/** @returns {MiceConfig} */
export function loadConfig() {
  return readJson(paths().config, {})
}

/** @param {MiceConfig} cfg */
export function saveConfig(cfg) {
  writeJson(paths().config, cfg)
}

/** @returns {MiceCredentials} */
export function loadCredentials() {
  return readJson(paths().creds, {})
}

/** @param {MiceCredentials} creds */
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

export function clearLoginState(remote) {
  const cfg = loadConfig()
  const drop = remote || cfg.remote
  if (drop) keychain().remove({ remote: drop })
  delete cfg.loggedInAt
  delete cfg.principal
  saveConfig(cfg)
  clearCredentials()
}

/**
 * Resolve BFF remote base URL (no trailing slash).
 * @param {{ remote?: string }} [opts]
 */
export function resolveRemote(opts = {}) {
  const fromEnv = process.env.MICE_REMOTE?.replace(/\/$/, '')
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

/** Token for API calls: the keychain entry for the remote. */
export function resolveToken() {
  const stored = credentialFor({ remote: resolveRemote() })
  return stored?.token?.trim() || null
}
