import { spawnSync } from 'node:child_process'

const SERVICE = 'mice'
const ACCOUNT = 'cli-credentials'

/**
 * @typedef {{
 *   principal: string
 *   remote: string
 *   token: string
 *   refreshToken?: string
 *   email?: string
 *   name?: string
 *   authHost?: string
 * }} CliCredential
 */

/**
 * @typedef {{
 *   put: (entry: CliCredential) => void
 *   list: () => CliCredential[]
 *   remove: (query: { remote: string }) => void
 * }} Keychain
 */

/**
 * @typedef {{
 *   read: () => string | null
 *   write: (secret: string) => void
 *   clear: () => void
 * }} SecretBackend
 */

/** @type {Keychain | null} */
let active = null

/**
 * One OS user holds credentials for a single Principal.
 * @param {CliCredential[]} rows
 * @param {CliCredential} entry
 */
function rejectSecondPrincipal(rows, entry) {
  const other = rows.find((row) => row.principal !== entry.principal)
  if (!other) return
  throw new Error(`This OS user already holds a credential for ${other.principal}`)
}

/**
 * Deep credential vault: principal policy + multi-remote rows behind put/list/remove.
 * Adapters only supply opaque secret bytes.
 * @param {SecretBackend} backend
 * @returns {Keychain}
 */
export function credentialVault(backend) {
  /** @returns {CliCredential[]} */
  function load() {
    const raw = backend.read()
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  /** @param {CliCredential[]} rows */
  function save(rows) {
    if (rows.length === 0) {
      backend.clear()
      return
    }
    backend.write(JSON.stringify(rows))
  }

  return {
    put(entry) {
      const existing = load()
      rejectSecondPrincipal(existing, entry)
      const rows = existing.filter(
        (row) => !(row.principal === entry.principal && row.remote === entry.remote),
      )
      rows.push({ ...entry })
      save(rows)
    },
    list() {
      return load()
    },
    remove(query) {
      save(load().filter((row) => row.remote !== query.remote))
    },
  }
}

/** In-memory stand-in for the OS keychain. */
export function memoryKeychain() {
  /** @type {string | null} */
  let secret = null
  return credentialVault({
    read: () => secret,
    write: (next) => {
      secret = next
    },
    clear: () => {
      secret = null
    },
  })
}

/** @param {Keychain | null} next */
export function useKeychain(next) {
  active = next
}

function osSecretBackend() {
  return {
    read() {
      const found = spawnSync(
        'security',
        ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'],
        { encoding: 'utf8' },
      )
      if (found.status !== 0) return null
      return String(found.stdout).trim()
    },
    write(secret) {
      const saved = spawnSync(
        'security',
        ['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-w', secret],
        { encoding: 'utf8' },
      )
      if (saved.status !== 0) {
        throw new Error(String(saved.stderr || 'Could not write the OS keychain').trim())
      }
    },
    clear() {
      spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], {
        encoding: 'utf8',
      })
    },
  }
}

function osKeychain() {
  return credentialVault(osSecretBackend())
}

/** @returns {Keychain} */
export function keychain() {
  if (!active) active = osKeychain()
  return active
}

/**
 * Sentence shown before a write when this OS user has more than one remote.
 * Returns null when no confirmation is needed.
 * @param {{ remote: string, write?: boolean }} query
 */
export function actingAsMessage(query) {
  if (!query.write) return null
  const rows = keychain().list()
  if (rows.length < 2) return null
  const stored = rows.find((row) => row.remote === query.remote)
  if (!stored) return null
  const who =
    stored.name && stored.email ? `${stored.name} <${stored.email}>` : stored.principal
  return `Acting as ${who} at ${query.remote}`
}

/** @param {{ remote: string }} query */
export function credentialFor(query) {
  const rows = keychain().list()
  return rows.find((row) => row.remote === query.remote) ?? null
}
