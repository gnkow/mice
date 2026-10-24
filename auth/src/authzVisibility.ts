import { normalizeGroup, userKey, type UserKey } from './authzTypes.js'
import { instancePermissions, isInstanceAdmin } from './authzInstanceStore.js'
import { resolveNamespaceRole } from './authzMembershipStore.js'
import { readCollaborators, readMembers, readNamespaces, sessionGroups } from './authzStoreFiles.js'

/**
 * True if the user is a namespace member/owner, instance admin, or has any
 * repo collaborator grant (user or IdP group) under the namespace.
 */
export function userCanSeeNamespace(
  user: UserKey & { groups?: string[] },
  ns: string,
): boolean {
  if (isInstanceAdmin(user)) return true
  if (resolveNamespaceRole(ns, user)) return true
  const prefix = `${ns}/`
  const uk = userKey(user)
  const groups = new Set((user.groups ?? []).map(normalizeGroup))
  const collab = readCollaborators()
  for (const [key, map] of Object.entries(collab.collaborators)) {
    if (!key.startsWith(prefix)) continue
    if (map[uk]) return true
  }
  for (const [key, map] of Object.entries(collab.groupCollaborators ?? {})) {
    if (!key.startsWith(prefix)) continue
    for (const g of groups) {
      if (map[g]) return true
    }
  }
  return false
}

/** Namespace names visible to the user (member, collab, or instance admin). */
export function visibleNamespaceNames(
  user: UserKey & { groups?: string[] },
): string[] | 'all' {
  if (isInstanceAdmin(user)) return 'all'
  const nsStore = readNamespaces()
  return Object.keys(nsStore.namespaces)
    .filter((ns) => userCanSeeNamespace(user, ns))
    .sort()
}

export function userHasAnyGrant(
  user: UserKey & { groups?: string[] },
): boolean {
  if (isInstanceAdmin(user)) return true
  if (instancePermissions(user).length > 0) return true
  const members = readMembers()
  const uk = userKey(user)
  for (const map of Object.values(members.members)) {
    if (map[uk]) return true
  }
  const groups = sessionGroups(user)
  if (groups.length) {
    for (const map of Object.values(members.groupMembers ?? {})) {
      for (const g of groups) {
        if (map[g]) return true
      }
    }
  }
  const collab = readCollaborators()
  for (const map of Object.values(collab.collaborators)) {
    if (map[uk]) return true
  }
  if (groups.length) {
    for (const map of Object.values(collab.groupCollaborators ?? {})) {
      for (const g of groups) {
        if (map[g]) return true
      }
    }
  }
  return false
}

export function ownedNamespaces(
  user: UserKey & { groups?: string[] },
): string[] {
  const out: string[] = []
  const members = readMembers()
  const uk = userKey(user)
  const groups = sessionGroups(user)
  for (const [ns, map] of Object.entries(members.members)) {
    if (map[uk] === 'owner') {
      out.push(ns)
      continue
    }
    const gMap = members.groupMembers?.[ns] ?? {}
    if (groups.some((g) => gMap[g] === 'owner')) out.push(ns)
  }
  // Namespaces only present in groupMembers
  for (const [ns, gMap] of Object.entries(members.groupMembers ?? {})) {
    if (out.includes(ns)) continue
    if (groups.some((g) => gMap[g] === 'owner')) out.push(ns)
  }
  return out
}
