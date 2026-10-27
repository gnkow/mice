export type DirectoryUserHit = {
  kind: 'user'
  sub: string
  iss: string
  email: string
  name: string
}

export type DirectoryGroupHit = {
  kind: 'group'
  group: string
  name: string
}

export type DirectoryHit = DirectoryUserHit | DirectoryGroupHit

export type DirectorySearchResult = {
  results: DirectoryHit[]
  source: 'keycloak' | 'store' | 'mixed' | 'none'
  providerConfigured: boolean
}

export type DirectoryUserStatus = 'enabled' | 'disabled' | 'missing' | 'error'

/** The external identity directory as the rest of auth sees it. Adapters answer empty/`error` on failure. */
export interface Directory {
  readonly configured: boolean
  /** Issuer stamped on user hits. */
  readonly issuer: string
  searchUsers(q: string, limit: number): Promise<DirectoryUserHit[]>
  searchGroups(q: string, limit: number): Promise<DirectoryGroupHit[]>
  /** `error` means the directory could not answer. */
  userStatus(sub: string): Promise<DirectoryUserStatus>
  /** Fetch all groups for a user by sub (for group overage handling). Returns empty on error. */
  getUserGroups(sub: string): Promise<string[]>
}
