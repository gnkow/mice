import { isPredefinedNsRole, normalizeGroup, parseUserKey, userKey, type MemberPrincipal, type MemberRoleRef, type NamespaceCapability, type NamespaceRole, type UserKey } from './authzTypes.js'
import { getCustomNamespaceRole, isValidMemberRole } from './customRoles.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
import { countNamespaceOwnersIn, readMembers, readNamespaces, sessionGroups, writeMembers } from './authzStoreFiles.js'

/** Direct user membership role ref (predefined or custom id). */
export function getNamespaceRoleRef(
  ns: string,
  user: UserKey,
): MemberRoleRef | null {
  return readMembers().members[ns]?.[userKey(user)] ?? null
}

/** @deprecated Prefer getNamespaceRoleRef; returns only predefined owner/member. */
export function getNamespaceRole(
  ns: string,
  user: UserKey,
): NamespaceRole | null {
  const r = getNamespaceRoleRef(ns, user)
  if (r && isPredefinedNsRole(r)) return r
  return null
}

function membershipRoleRefs(
  ns: string,
  user: UserKey & { groups?: string[] },
): MemberRoleRef[] {
  const out: MemberRoleRef[] = []
  const direct = getNamespaceRoleRef(ns, user)
  if (direct) out.push(direct)
  const map = readMembers().groupMembers?.[ns] ?? {}
  for (const g of sessionGroups(user)) {
    const r = map[g]
    if (r) out.push(r)
  }
  return out
}

/**
 * Additive namespace role: user seat ∪ IdP group bindings.
 * Owner beats Member. Custom namespace roles count as Member for base perms.
 */
export function resolveNamespaceRole(
  ns: string,
  user: UserKey & { groups?: string[] },
): NamespaceRole | null {
  const refs = membershipRoleRefs(ns, user)
  if (refs.some((r) => r === 'owner')) return 'owner'
  if (refs.some((r) => r === 'member')) return 'member'
  if (refs.some((r) => !isPredefinedNsRole(r) && getCustomNamespaceRole(ns, r))) {
    return 'member'
  }
  return null
}

export function isNamespaceMember(
  ns: string,
  user: UserKey & { groups?: string[] },
): boolean {
  return resolveNamespaceRole(ns, user) !== null
}

/** Custom namespace role ids held by the user (direct + groups). */
export function customNamespaceRoleIds(
  ns: string,
  user: UserKey & { groups?: string[] },
): string[] {
  const ids: string[] = []
  for (const r of membershipRoleRefs(ns, user)) {
    if (!isPredefinedNsRole(r) && getCustomNamespaceRole(ns, r)) ids.push(r)
  }
  return ids
}

export function hasNamespaceCapability(
  ns: string,
  user: UserKey & { groups?: string[] },
  cap: NamespaceCapability,
): boolean {
  if (isInstanceAdmin(user)) return true
  if (resolveNamespaceRole(ns, user) === 'owner') return true
  for (const id of customNamespaceRoleIds(ns, user)) {
    const role = getCustomNamespaceRole(ns, id)
    if (role?.permissions.includes(cap)) return true
  }
  return false
}

export function namespacesWithCapability(
  user: UserKey & { groups?: string[] },
  cap: NamespaceCapability,
): string[] {
  const out: string[] = []
  for (const ns of Object.keys(readNamespaces().namespaces)) {
    if (hasNamespaceCapability(ns, user, cap)) out.push(ns)
  }
  return out.sort()
}

export function isCustomNamespaceRoleAssigned(ns: string, roleId: string): boolean {
  const members = readMembers()
  for (const r of Object.values(members.members[ns] ?? {})) {
    if (r === roleId) return true
  }
  for (const r of Object.values(members.groupMembers?.[ns] ?? {})) {
    if (r === roleId) return true
  }
  return false
}

export function listNamespaceMembers(ns: string): MemberPrincipal[] {
  const store = readMembers()
  const users = Object.entries(store.members[ns] ?? {}).map(([key, role]) => {
    const u = parseUserKey(key)
    return { kind: 'user' as const, ...u, role }
  })
  const groups = Object.entries(store.groupMembers?.[ns] ?? {}).map(
    ([group, role]) => ({ kind: 'group' as const, group, role }),
  )
  return [...users, ...groups]
}

export function setNamespaceMember(
  ns: string,
  target: UserKey,
  role: MemberRoleRef,
): { ok: true } | { ok: false; error: string } {
  if (!isValidMemberRole(ns, role)) {
    return { ok: false, error: 'Invalid role' }
  }
  const members = readMembers()
  if (!readNamespaces().namespaces[ns]) {
    return { ok: false, error: 'Namespace not found' }
  }
  if (!members.members[ns]) members.members[ns] = {}
  if (!members.groupMembers) members.groupMembers = {}
  const map = members.members[ns]
  const key = userKey(target)
  const prev = map[key]
  map[key] = role
  if (prev === 'owner' && role !== 'owner') {
    if (countNamespaceOwnersIn(members, ns) === 0) {
      map[key] = 'owner'
      return { ok: false, error: 'Cannot demote the last namespace Owner' }
    }
  }
  writeMembers(members)
  return { ok: true }
}

export function removeNamespaceMember(
  ns: string,
  target: UserKey,
): { ok: true } | { ok: false; error: string } {
  const members = readMembers()
  const map = members.members[ns]
  if (!map) return { ok: false, error: 'Namespace not found' }
  const key = userKey(target)
  if (map[key] === 'owner' && countNamespaceOwnersIn(members, ns) <= 1) {
    return { ok: false, error: 'Cannot remove the last namespace Owner' }
  }
  delete map[key]
  writeMembers(members)
  return { ok: true }
}

export function setNamespaceGroupMember(
  ns: string,
  group: string,
  role: MemberRoleRef,
): { ok: true } | { ok: false; error: string } {
  if (!isValidMemberRole(ns, role)) {
    return { ok: false, error: 'Invalid role' }
  }
  const g = normalizeGroup(group)
  if (!g) return { ok: false, error: 'Group name required' }
  const members = readMembers()
  if (!readNamespaces().namespaces[ns]) {
    return { ok: false, error: 'Namespace not found' }
  }
  if (!members.groupMembers) members.groupMembers = {}
  if (!members.groupMembers[ns]) members.groupMembers[ns] = {}
  const map = members.groupMembers[ns]
  const prev = map[g]
  map[g] = role
  if (
    prev === 'owner' &&
    role !== 'owner' &&
    countNamespaceOwnersIn(members, ns) === 0
  ) {
    map[g] = 'owner'
    return { ok: false, error: 'Cannot demote the last namespace Owner' }
  }
  writeMembers(members)
  return { ok: true }
}

export function removeNamespaceGroupMember(
  ns: string,
  group: string,
): { ok: true } | { ok: false; error: string } {
  const g = normalizeGroup(group)
  const members = readMembers()
  const map = members.groupMembers?.[ns]
  if (!map || !map[g]) return { ok: false, error: 'Group member not found' }
  if (map[g] === 'owner' && countNamespaceOwnersIn(members, ns) <= 1) {
    return { ok: false, error: 'Cannot remove the last namespace Owner' }
  }
  delete map[g]
  writeMembers(members)
  return { ok: true }
}
