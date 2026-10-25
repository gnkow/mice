import {
  isPredefinedNsRole,
  normalizeGroup,
  parseUserKey,
  userKey,
  type MemberPrincipal,
  type MemberRoleRef,
  type NamespaceCapability,
  type NamespaceRole,
  type UserKey,
} from './authzTypes.js'
import { getCustomNamespaceRole, isValidMemberRole } from './customRoles.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
import * as repo from './authzRepository.js'

type Result = { ok: true } | { ok: false; error: string }
type Who = UserKey & { groups?: string[] }

const who = (user: Who) => ({ key: userKey(user), groups: repo.sessionGroups(user) })

/** Direct user membership role ref (predefined or custom id). */
export async function getNamespaceRoleRef(ns: string, user: UserKey): Promise<MemberRoleRef | null> {
  return repo.directMemberRole(ns, userKey(user))
}

/** @deprecated Prefer getNamespaceRoleRef; returns only predefined owner/member. */
export async function getNamespaceRole(ns: string, user: UserKey): Promise<NamespaceRole | null> {
  const r = await getNamespaceRoleRef(ns, user)
  return r && isPredefinedNsRole(r) ? r : null
}

async function rolesFromRefs(ns: string, refs: MemberRoleRef[]): Promise<NamespaceRole | null> {
  if (refs.some((r) => r === 'owner')) return 'owner'
  if (refs.some((r) => r === 'member')) return 'member'
  for (const r of refs) {
    if (!isPredefinedNsRole(r) && (await getCustomNamespaceRole(ns, r))) return 'member'
  }
  return null
}

/**
 * Additive namespace role: user seat ∪ IdP group bindings.
 * Owner beats Member. Custom namespace roles count as Member for base perms.
 */
export async function resolveNamespaceRole(ns: string, user: Who): Promise<NamespaceRole | null> {
  const refs = await repo.membershipRefs(who(user), ns)
  return rolesFromRefs(ns, refs.map((r) => r.role))
}

/** Resolved role for every namespace the user holds a seat or group binding in. */
export async function namespaceRolesFor(user: Who): Promise<Map<string, NamespaceRole | null>> {
  const refs = await repo.membershipRefs(who(user))
  const byNs = new Map<string, MemberRoleRef[]>()
  for (const r of refs) byNs.set(r.namespace, [...(byNs.get(r.namespace) ?? []), r.role])
  const out = new Map<string, NamespaceRole | null>()
  for (const [ns, roles] of byNs) out.set(ns, await rolesFromRefs(ns, roles))
  return out
}

export async function isNamespaceMember(ns: string, user: Who): Promise<boolean> {
  return (await resolveNamespaceRole(ns, user)) !== null
}

/** Custom namespace role ids held by the user (direct + groups). */
export async function customNamespaceRoleIds(ns: string, user: Who): Promise<string[]> {
  const refs = await repo.membershipRefs(who(user), ns)
  const ids: string[] = []
  for (const { role } of refs) {
    if (!isPredefinedNsRole(role) && (await getCustomNamespaceRole(ns, role))) ids.push(role)
  }
  return ids
}

export async function hasNamespaceCapability(ns: string, user: Who, cap: NamespaceCapability): Promise<boolean> {
  if (await isInstanceAdmin(user)) return true
  if ((await resolveNamespaceRole(ns, user)) === 'owner') return true
  for (const id of await customNamespaceRoleIds(ns, user)) {
    const role = await getCustomNamespaceRole(ns, id)
    if (role?.permissions.includes(cap)) return true
  }
  return false
}

export async function namespacesWithCapability(user: Who, cap: NamespaceCapability): Promise<string[]> {
  const out: string[] = []
  for (const ns of Object.keys(await repo.readNamespaces())) {
    if (await hasNamespaceCapability(ns, user, cap)) out.push(ns)
  }
  return out.sort()
}

export async function isCustomNamespaceRoleAssigned(ns: string, roleId: string): Promise<boolean> {
  return repo.isMemberRoleAssigned(ns, roleId)
}

export async function listNamespaceMembers(ns: string): Promise<MemberPrincipal[]> {
  const { users, groups } = await repo.listMemberRows(ns)
  return [
    ...users.map((r) => ({ kind: 'user' as const, ...parseUserKey(r.key), role: r.role })),
    ...groups.map((r) => ({ kind: 'group' as const, group: r.group, role: r.role })),
  ]
}

export async function setNamespaceMember(ns: string, target: UserKey, role: MemberRoleRef): Promise<Result> {
  if (!(await isValidMemberRole(ns, role))) return { ok: false, error: 'Invalid role' }
  return repo.setMember(ns, userKey(target), role)
}

export async function removeNamespaceMember(ns: string, target: UserKey): Promise<Result> {
  return repo.removeMember(ns, userKey(target))
}

export async function setNamespaceGroupMember(ns: string, group: string, role: MemberRoleRef): Promise<Result> {
  if (!(await isValidMemberRole(ns, role))) return { ok: false, error: 'Invalid role' }
  const g = normalizeGroup(group)
  if (!g) return { ok: false, error: 'Group name required' }
  return repo.setGroupMember(ns, g, role)
}

export async function removeNamespaceGroupMember(ns: string, group: string): Promise<Result> {
  return repo.removeGroupMember(ns, normalizeGroup(group))
}
