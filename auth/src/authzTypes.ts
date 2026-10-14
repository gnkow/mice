export type NamespaceRole = 'owner' | 'member'

export type RepoRole = 'read' | 'triage' | 'write' | 'maintain' | 'admin'

export type BasePermission = 'none' | RepoRole

export type InstancePermission =
  | 'create_namespace'
  | 'view_audit'
  | 'manage_breakglass'

/** Stored membership role: predefined or custom namespace role id. */
export type MemberRoleRef = NamespaceRole | string

/** Stored collaborator role: predefined or custom repo role id. */
export type CollaboratorRoleRef = RepoRole | string

export type NamespaceCapability =
  | 'manage_members'
  | 'manage_settings'
  | 'manage_custom_roles'
  | 'create_repos'
  | 'view_audit'
  | 'review_access_requests'
  | 'delete_namespace'

export type RepoFinePermission =
  | 'contents_read'
  | 'contents_write'
  | 'workspaces'
  | 'merge'
  | 'delete_branch'
  | 'manage_collaborators'
  | 'manage_repo_metadata'
  | 'repo_delete'
  | 'other_mutate'

export type UserKey = { sub: string; iss: string }

export type MemberPrincipal =
  | { kind: 'user'; sub: string; iss: string; role: MemberRoleRef }
  | { kind: 'group'; group: string; role: MemberRoleRef }

export type CollaboratorPrincipal =
  | { kind: 'user'; sub: string; iss: string; role: CollaboratorRoleRef }
  | { kind: 'group'; group: string; role: CollaboratorRoleRef }

export function userKey(user: UserKey): string {
  return `${user.iss}\0${user.sub}`
}

export function parseUserKey(key: string): UserKey {
  const i = key.indexOf('\0')
  if (i < 0) return { iss: '', sub: key }
  return { iss: key.slice(0, i), sub: key.slice(i + 1) }
}

/** Normalize IdP group name for storage and matching (lowercase, trimmed). */
export function normalizeGroup(name: string): string {
  return name.trim().toLowerCase()
}

/** Parse a groups claim (string or string[]) into normalized unique names. */
export function normalizeGroupsClaim(raw: unknown): string[] {
  const list: string[] = []
  if (typeof raw === 'string') {
    list.push(raw)
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') list.push(item)
    }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const g of list) {
    const n = normalizeGroup(g)
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

export const REPO_ROLE_RANK: Record<BasePermission, number> = {
  none: 0,
  read: 1,
  triage: 2,
  write: 3,
  maintain: 4,
  admin: 5,
}

export function maxRepoRole(a: BasePermission, b: BasePermission): BasePermission {
  return REPO_ROLE_RANK[a] >= REPO_ROLE_RANK[b] ? a : b
}

export function roleAtLeast(
  have: BasePermission,
  need: RepoRole,
): boolean {
  return REPO_ROLE_RANK[have] >= REPO_ROLE_RANK[need]
}

export function isPredefinedNsRole(role: string): role is NamespaceRole {
  return role === 'owner' || role === 'member'
}

export function isPredefinedRepoRole(role: string): role is RepoRole {
  return (
    role === 'read' ||
    role === 'triage' ||
    role === 'write' ||
    role === 'maintain' ||
    role === 'admin'
  )
}
