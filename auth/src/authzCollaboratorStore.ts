import { isPredefinedRepoRole, maxRepoRole, normalizeGroup, parseUserKey, userKey, type BasePermission, type CollaboratorPrincipal, type CollaboratorRoleRef, type RepoRole, type UserKey } from './authzTypes.js'
import { getCustomRepoRole, isValidCollaboratorRole } from './customRoles.js'
import * as authzRepo from './authzRepository.js'

export function isCustomRepoRoleAssigned(ns: string, roleId: string): boolean {
  const collab = authzRepo.collaboratorsSnapshot()
  const prefix = `${ns}/`
  for (const [key, map] of Object.entries(collab.collaborators)) {
    if (!key.startsWith(prefix)) continue
    if (Object.values(map).some((r) => r === roleId)) return true
  }
  for (const [key, map] of Object.entries(collab.groupCollaborators ?? {})) {
    if (!key.startsWith(prefix)) continue
    if (Object.values(map).some((r) => r === roleId)) return true
  }
  return false
}

export function getRepoCollaboratorRoleRef(
  ns: string,
  repo: string,
  user: UserKey,
): CollaboratorRoleRef | null {
  return (
    authzRepo.collaboratorsSnapshot().collaborators[authzRepo.repoKey(ns, repo)]?.[userKey(user)] ??
    null
  )
}

/** Effective predefined rank from a collaborator role ref. */
export function collaboratorRoleToBase(
  ns: string,
  role: CollaboratorRoleRef,
): BasePermission {
  if (isPredefinedRepoRole(role)) return role
  const custom = getCustomRepoRole(ns, role)
  return custom?.base ?? 'none'
}

export function getRepoCollaboratorRole(
  ns: string,
  repo: string,
  user: UserKey,
): RepoRole | null {
  const ref = getRepoCollaboratorRoleRef(ns, repo, user)
  if (!ref) return null
  const base = collaboratorRoleToBase(ns, ref)
  return base === 'none' ? null : (base as RepoRole)
}

/** Max repo collaborator role from IdP group bindings (resolved to base rank). */
export function getRepoCollaboratorRoleFromGroups(
  ns: string,
  repo: string,
  groups: string[],
): RepoRole | null {
  const map =
    authzRepo.collaboratorsSnapshot().groupCollaborators?.[authzRepo.repoKey(ns, repo)] ?? {}
  let role: BasePermission = 'none'
  for (const g of groups.map(normalizeGroup).filter(Boolean)) {
    const r = map[g]
    if (r) role = maxRepoRole(role, collaboratorRoleToBase(ns, r))
  }
  return role === 'none' ? null : (role as RepoRole)
}

/** Custom repo role refs held on this repo (user + groups). */
export function customRepoRoleIdsForUser(
  ns: string,
  repo: string,
  user: UserKey & { groups?: string[] },
): string[] {
  const ids: string[] = []
  const direct = getRepoCollaboratorRoleRef(ns, repo, user)
  if (direct && !isPredefinedRepoRole(direct) && getCustomRepoRole(ns, direct)) {
    ids.push(direct)
  }
  const map =
    authzRepo.collaboratorsSnapshot().groupCollaborators?.[authzRepo.repoKey(ns, repo)] ?? {}
  for (const g of authzRepo.sessionGroups(user)) {
    const r = map[g]
    if (r && !isPredefinedRepoRole(r) && getCustomRepoRole(ns, r)) ids.push(r)
  }
  return ids
}

export function listRepoCollaborators(
  ns: string,
  repo: string,
): CollaboratorPrincipal[] {
  const store = authzRepo.collaboratorsSnapshot()
  const key = authzRepo.repoKey(ns, repo)
  const users = Object.entries(store.collaborators[key] ?? {}).map(
    ([k, role]) => {
      const u = parseUserKey(k)
      return { kind: 'user' as const, ...u, role }
    },
  )
  const groups = Object.entries(store.groupCollaborators?.[key] ?? {}).map(
    ([group, role]) => ({ kind: 'group' as const, group, role }),
  )
  return [...users, ...groups]
}

/** All repo collaborator principals across namespaces (for directory store search). */
export function listAllCollaboratorPrincipals(): CollaboratorPrincipal[] {
  const store = authzRepo.collaboratorsSnapshot()
  const out: CollaboratorPrincipal[] = []
  for (const map of Object.values(store.collaborators)) {
    for (const [k, role] of Object.entries(map)) {
      const u = parseUserKey(k)
      out.push({ kind: 'user', ...u, role })
    }
  }
  for (const map of Object.values(store.groupCollaborators ?? {})) {
    for (const [group, role] of Object.entries(map)) {
      out.push({ kind: 'group', group, role })
    }
  }
  return out
}

export function setRepoCollaborator(
  ns: string,
  repoName: string,
  target: UserKey,
  role: CollaboratorRoleRef,
): { ok: true } | { ok: false; error: string } {
  if (!isValidCollaboratorRole(ns, role)) {
    return { ok: false, error: 'Invalid role' }
  }
  authzRepo.setCollaborator(ns, repoName, userKey(target), role)
  return { ok: true }
}

export function removeRepoCollaborator(
  ns: string,
  repoName: string,
  target: UserKey,
): boolean {
  return authzRepo.removeCollaborator(ns, repoName, userKey(target))
}

export function setRepoGroupCollaborator(
  ns: string,
  repoName: string,
  group: string,
  role: CollaboratorRoleRef,
): { ok: true } | { ok: false; error: string } {
  if (!isValidCollaboratorRole(ns, role)) {
    return { ok: false, error: 'Invalid role' }
  }
  const g = normalizeGroup(group)
  if (!g) return { ok: false, error: 'Group name required' }
  authzRepo.setGroupCollaborator(ns, repoName, g, role)
  return { ok: true }
}

export function removeRepoGroupCollaborator(
  ns: string,
  repoName: string,
  group: string,
): boolean {
  return authzRepo.removeGroupCollaborator(ns, repoName, normalizeGroup(group))
}
