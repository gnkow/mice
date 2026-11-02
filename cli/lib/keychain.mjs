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

/** In-memory stand-in for the OS keychain. */
export function memoryKeychain() {
  /** @type {Map<string, CliCredential>} */
  const rows = new Map()
  return {
    put(entry) {
      rejectSecondPrincipal([...rows.values()], entry)
      rows.set(`${entry.principal}\n${entry.remote}`, { ...entry })
    },
    list() {
      return [...rows.values()]
    },
    remove(query) {
      for (const [key, row] of rows) {
        if (row.remote === query.remote) rows.delete(key)
      }
    },
  }
}

/** @param {Keychain | null} next */
export function useKeychain(next) {
  active = next
}

function osKeychain() {
  return {
    list() {
      const found = spawnSync(
        'security',
        ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'],
        { encoding: 'utf8' },
      )
      if (found.status !== 0) return []
      try {
        const parsed = JSON.parse(String(found.stdout).trim())
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    },
    put(entry) {
      const existing = this.list()
      rejectSecondPrincipal(existing, entry)
      const rows = existing.filter(
        (row) => !(row.principal === entry.principal && row.remote === entry.remote),
      )
      rows.push({ ...entry })
      const saved = spawnSync(
        'security',
        ['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-w', JSON.stringify(rows)],
        { encoding: 'utf8' },
      )
      if (saved.status !== 0) {
        throw new Error(String(saved.stderr || 'Could not write the OS keychain').trim())
      }
    },
    remove(query) {
      const rows = this.list().filter((row) => row.remote !== query.remote)
      if (rows.length === 0) {
        spawnSync('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT], {
          encoding: 'utf8',
        })
        return
      }
      const saved = spawnSync(
        'security',
        ['add-generic-password', '-U', '-s', SERVICE, '-a', ACCOUNT, '-w', JSON.stringify(rows)],
        { encoding: 'utf8' },
      )
      if (saved.status !== 0) {
        throw new Error(String(saved.stderr || 'Could not write the OS keychain').trim())
      }
    },
  }
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
