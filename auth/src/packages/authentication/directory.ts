/** Directory/IdP face. */
export {
  directoryNow,
  setDirectoryFetchForTests,
  setDirectoryForTests,
  searchDirectory,
  keycloakDirectoryConfigured,
  directoryIssuer,
  lookupKeycloakUserStatus,
  searchStoreDirectory,
  collectStorePrincipals,
  createDirectoryService,
} from './lib/directory/directory.js'
export type {
  Directory,
  DirectoryFetch,
  DirectoryHit,
  DirectorySearchResult,
  DirectoryUserHit,
  DirectoryUserState,
  DirectoryUserStatus,
} from './lib/directory/directory.js'
export { canSearchDirectory } from './lib/directory/directoryPolicy.js'
