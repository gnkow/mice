import { createKeycloakDirectory, keycloakConfigFromEnv } from './directoryKeycloak.js'
import type { Directory } from './directoryTypes.js'

export type DirectoryFetch = typeof fetch

let lazyDirectory: Directory | null = null

export const directoryNow = (): Directory => (lazyDirectory ??= createKeycloakDirectory(keycloakConfigFromEnv))

/** Test hook: inject fetch (e.g. mock Keycloak); null restores the real one. Resets the token cache. */
export function setDirectoryFetchForTests(fn: DirectoryFetch | null): void {
  lazyDirectory = createKeycloakDirectory(keycloakConfigFromEnv, fn ? { fetch: fn } : {})
}

/** Test hook: replace the whole Directory adapter; null clears so the next call rebuilds. */
export function setDirectoryForTests(directory: Directory | null): void {
  lazyDirectory = directory
}
