export type DirectoryUserHit = {
  kind: 'user'
  sub: string
  iss: string
  email: string
  name: string
}

export type DirectoryGroupHit = {
  kind: 'group'
  /** IdP object id when the directory has one; otherwise the normalized display name. */
  group: string
  /** Current display name. */
  name: string
}

/** A group membership fetched for a user. `id` is the grant key. */
export type DirectoryGroup = {
  id: string
  name: string
}

export type DirectoryHit = DirectoryUserHit | DirectoryGroupHit

export type DirectorySearchResult = {
  results: DirectoryHit[]
  source: 'keycloak' | 'store' | 'mixed' | 'none'
  providerConfigured: boolean
}

export type DirectoryUserStatus = 'enabled' | 'disabled' | 'missing' | 'error'

/** IdP account state from the same lookup that reads whether the user is enabled. */
export type DirectoryUserState = {
  status: DirectoryUserStatus
  /** Display name from the IdP. Empty when the IdP has none. */
  name: string
}

/** The external identity directory as the rest of auth sees it. Adapters answer empty/`error` on failure. */
export interface Directory {
  readonly configured: boolean
  /** Issuer stamped on user hits. */
  readonly issuer: string
  searchUsers(q: string, limit: number): Promise<DirectoryUserHit[]>
  searchGroups(q: string, limit: number): Promise<DirectoryGroupHit[]>
  /** `error` means the directory could not answer. `name` is the IdP display name. */
  userStatus(sub: string): Promise<DirectoryUserState>
  /** Fetch all groups for a user by sub (for group overage handling). Returns empty on error. */
  getUserGroups(sub: string): Promise<DirectoryGroup[]>
  /** Current display name for one group id. Null when the directory has no such group. */
  getGroup(id: string): Promise<DirectoryGroup | null>
}
