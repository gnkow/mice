import {
  isPredefinedRepoRole,
  maxRepoRole,
  parseUserKey,
  userKey,
  type BasePermission,
  type CollaboratorPrincipal,
  type CollaboratorRoleRef,
  type RepoRole,
  type UserKey,
} from './authzTypes.js'
import { getCustomRepoRole, isValidCollaboratorRole } from './customRoles.js'
import * as authzRepo from './authzRepository.js'
import { toGroupBindingKey } from './groupBinding.js'
import { defaultGroupIssuer, getGroupDisplayName, upsertGroupDisplayNames } from './groupDisplayStore.js'

type Result = { ok: true } | { ok: false; error: string }

export async function isCustomRepoRoleAssigned(ns: string, roleId: string): Promise<boolean> {
  return authzRepo.isRepoRoleAssigned(ns, roleId)
}

export async function getRepoCollaboratorRoleRef(ns: string, repo: string, user: UserKey): Promise<CollaboratorRoleRef | null> {
  return authzRepo.directCollaboratorRole(ns, repo, userKey(user))
}

/** Effective predefined rank from a collaborator role ref. */
export async function collaboratorRoleToBase(ns: string, role: CollaboratorRoleRef): Promise<BasePermission> {
  if (isPredefinedRepoRole(role)) return role
  return (await getCustomRepoRole(ns, role))?.base ?? 'none'
}

export async function getRepoCollaboratorRole(ns: string, repo: string, user: UserKey): Promise<RepoRole | null> {
  const ref = await getRepoCollaboratorRoleRef(ns, repo, user)
  if (!ref) return null
  const base = await collaboratorRoleToBase(ns, ref)
  return base === 'none' ? null : (base as RepoRole)
}

/** Max repo collaborator role from IdP group bindings (resolved to base rank). */
export async function getRepoCollaboratorRoleFromGroups(ns: string, repo: string, groups: string[]): Promise<RepoRole | null> {
  const keys = groups.map((g) => toGroupBindingKey(defaultGroupIssuer(), g).bindingKey)
  const rows = await authzRepo.groupCollaboratorRoles(ns, repo, keys)
  let role: BasePermission = 'none'
  for (const r of rows) role = maxRepoRole(role, await collaboratorRoleToBase(ns, r.role))
  return role === 'none' ? null : (role as RepoRole)
}

/** Custom repo role refs held on this repo (user + groups). */
export async function customRepoRoleIdsForUser(
  ns: string,
  repo: string,
  user: UserKey & { groups?: string[] },
): Promise<string[]> {
  const ids: string[] = []
  const direct = await getRepoCollaboratorRoleRef(ns, repo, user)
  if (direct && !isPredefinedRepoRole(direct) && (await getCustomRepoRole(ns, direct))) ids.push(direct)
  for (const r of await authzRepo.groupCollaboratorRoles(ns, repo, authzRepo.sessionGroups(user))) {
    if (!isPredefinedRepoRole(r.role) && (await getCustomRepoRole(ns, r.role))) ids.push(r.role)
  }
  return ids
}

export async function listRepoCollaborators(ns: string, repo: string): Promise<CollaboratorPrincipal[]> {
  const { users, groups } = await authzRepo.listCollaboratorRows(ns, repo)
  const named = await Promise.all(groups.map(async (row) => ({
    kind: 'group' as const,
    group: row.group,
    role: row.role,
    name: await getGroupDisplayName(row.group),
  })))
  return [
    ...users.map((r) => ({ kind: 'user' as const, ...parseUserKey(r.key), role: r.role })),
    ...named,
  ]
}

/** All repo collaborator principals across namespaces (for directory store search). */
export async function listAllCollaboratorPrincipals(): Promise<CollaboratorPrincipal[]> {
  const { users, groups } = await authzRepo.listAllCollaboratorRows()
  return [
    ...users.map((r) => ({ kind: 'user' as const, ...parseUserKey(r.key), role: r.role })),
    ...groups.map((r) => ({ kind: 'group' as const, group: r.group, role: r.role })),
  ]
}

export async function setRepoCollaborator(ns: string, repoName: string, target: UserKey, role: CollaboratorRoleRef): Promise<Result> {
  if (!(await isValidCollaboratorRole(ns, role))) return { ok: false, error: 'Invalid role' }
  await authzRepo.setCollaborator(ns, repoName, userKey(target), role)
  return { ok: true }
}

export async function removeRepoCollaborator(ns: string, repoName: string, target: UserKey): Promise<boolean> {
  return authzRepo.removeCollaborator(ns, repoName, userKey(target))
}

export async function setRepoGroupCollaborator(
  ns: string,
  repoName: string,
  group: string,
  role: CollaboratorRoleRef,
  opts?: { iss?: string; displayName?: string },
): Promise<Result> {
  if (!(await isValidCollaboratorRole(ns, role))) return { ok: false, error: 'Invalid role' }
  if (!group.trim()) return { ok: false, error: 'Group name required' }
  const { bindingKey, idBased, groupId } = toGroupBindingKey(opts?.iss ?? defaultGroupIssuer(), group)
  const displayName = (opts?.displayName ?? '').trim() || groupId
  await upsertGroupDisplayNames([{ bindingKey, displayName, idBased }])
  await authzRepo.setGroupCollaborator(ns, repoName, bindingKey, role)
  return { ok: true }
}

export async function removeRepoGroupCollaborator(ns: string, repoName: string, group: string): Promise<boolean> {
  const { bindingKey } = toGroupBindingKey(defaultGroupIssuer(), group)
  return authzRepo.removeGroupCollaborator(ns, repoName, bindingKey)
}
