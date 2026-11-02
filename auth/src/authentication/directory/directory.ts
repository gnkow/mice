import { normalizeGroup } from '../../authzTypes.js'
import { collectStorePrincipals as collectProjection, searchStoreDirectory as searchProjection } from './directoryProjection.js'
import { createKeycloakDirectory, keycloakConfigFromEnv } from './directoryKeycloak.js'
import type {
  Directory,
  DirectoryHit,
  DirectorySearchResult,
  DirectoryUserHit,
  DirectoryUserStatus,
} from './directoryTypes.js'
import { principalKey } from '../session/principal.js'

export type {
  Directory,
  DirectoryGroupHit,
  DirectoryHit,
  DirectorySearchResult,
  DirectoryUserHit,
  DirectoryUserState,
  DirectoryUserStatus,
} from './directoryTypes.js'
export { canSearchDirectory } from './directoryPolicy.js'

export type DirectoryFetch = typeof fetch

function mergeHits(
  primary: DirectoryHit[],
  secondary: DirectoryHit[],
  limit: number,
): DirectoryHit[] {
  const seen = new Set<string>()
  const out: DirectoryHit[] = []
  for (const h of [...primary, ...secondary]) {
    const key =
      h.kind === 'user' ? `u:${principalKey(h)}` : `g:${normalizeGroup(h.group)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

export type SearchInput = { q: string; kind?: 'user' | 'group'; limit?: number }

/** Directory search: the external Directory merged with the local projection. */
export function createDirectoryService(directory: Directory) {
  return {
    async search(input: SearchInput): Promise<DirectorySearchResult> {
      const q = (input.q ?? '').trim()
      const kind = input.kind === 'group' ? 'group' : 'user'
      const limit = Math.min(Math.max(1, input.limit ?? 25), 50)
      const configured = directory.configured
      if (!q) return { results: [], source: 'none', providerConfigured: configured }

      const storeHits = await searchProjection(q, kind, limit, directory.issuer)
      let remoteHits: DirectoryHit[] = []
      if (configured) {
        remoteHits =
          kind === 'group' ? await directory.searchGroups(q, limit) : await directory.searchUsers(q, limit)
      }

      if (configured && (remoteHits.length > 0 || storeHits.length > 0)) {
        const source =
          remoteHits.length > 0 && storeHits.length > 0 ? 'mixed' : remoteHits.length > 0 ? 'keycloak' : 'store'
        return { results: mergeHits(remoteHits, storeHits, limit), source, providerConfigured: true }
      }
      if (storeHits.length > 0) {
        return { results: storeHits.slice(0, limit), source: 'store', providerConfigured: configured }
      }
      if (configured) {
        return {
          results: remoteHits.slice(0, limit),
          source: remoteHits.length ? 'keycloak' : 'none',
          providerConfigured: true,
        }
      }
      return { results: [], source: 'none', providerConfigured: false }
    },
  }
}

let lazyDirectory: Directory | null = null
export const directoryNow = (): Directory => (lazyDirectory ??= createKeycloakDirectory(keycloakConfigFromEnv))

/** Test hook: inject fetch (e.g. mock Keycloak); null restores the real one. Resets the token cache. */
export function setDirectoryFetchForTests(fn: DirectoryFetch | null): void {
  lazyDirectory = createKeycloakDirectory(keycloakConfigFromEnv, fn ? { fetch: fn } : {})
}

export const keycloakDirectoryConfigured = (): boolean => directoryNow().configured
export const directoryIssuer = (): string => directoryNow().issuer
export const lookupKeycloakUserStatus = async (sub: string): Promise<DirectoryUserStatus> =>
  (await directoryNow().userStatus(sub)).status
export const searchDirectory = (input: SearchInput): Promise<DirectorySearchResult> =>
  createDirectoryService(directoryNow()).search(input)

export const searchStoreDirectory = (q: string, kind: 'user' | 'group', limit: number): Promise<DirectoryHit[]> =>
  searchProjection(q, kind, limit, directoryNow().issuer)
export const collectStorePrincipals = (
  opts: { includePatOwners?: boolean } = {},
): Promise<Map<string, DirectoryUserHit>> => collectProjection({ ...opts, defaultIssuer: directoryNow().issuer })
