import { parsePrincipalKey, principalKey } from './authentication/index.js'
import {
  INSTANCE_PERMISSIONS,
  type InstancePermission,
  type NamespaceCapability,
  type NamespaceRole,
  type RepoFinePermission,
  type RepoRole,
} from './authzContract.js'

export type { InstancePermission, NamespaceCapability, NamespaceRole, RepoFinePermission, RepoRole }

export type BasePermission = 'none' | RepoRole

/** Full instance permission catalog (admins receive all). */
export const ALL_INSTANCE_PERMISSIONS: InstancePermission[] = [...INSTANCE_PERMISSIONS]

/** Stored membership role: predefined or custom namespace role id. */
export type MemberRoleRef = NamespaceRole | string

/** Stored collaborator role: predefined or custom repo role id. */
export type CollaboratorRoleRef = RepoRole | string

export type UserKey = { sub: string; iss: string }

export type GroupBindingModeLabel = 'id-based' | 'name-based'

export type MemberPrincipal =
  | { kind: 'user'; sub: string; iss: string; role: MemberRoleRef }
  | {
      kind: 'group'
      group: string
      role: MemberRoleRef
      name?: string
      bindingMode?: GroupBindingModeLabel
    }

export type CollaboratorPrincipal =
  | { kind: 'user'; sub: string; iss: string; role: CollaboratorRoleRef }
  | {
      kind: 'group'
      group: string
      role: CollaboratorRoleRef
      name?: string
      bindingMode?: GroupBindingModeLabel
    }

export const userKey = principalKey
export const parseUserKey = parsePrincipalKey

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
