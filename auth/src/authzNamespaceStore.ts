import type { SessionUser } from './session.js'
import { userKey, type BasePermission, type NamespaceRole, type UserKey } from './authzTypes.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
import { resolveNamespaceRole } from './authzMembershipStore.js'
import * as repo from './authzRepository.js'

export function getNamespace(ns: string) {
  return repo.namespacesSnapshot().namespaces[ns] ?? null
}

export function listNamespacesAuthz() {
  return repo.namespacesSnapshot().namespaces
}

/** Namespaces visible to the user (member/owner), or all if instance admin. */
export function listNamespacesForUser(
  user: UserKey & { groups?: string[] },
): Array<{
  name: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
  createdAt: string
  memberCount: number
  role: NamespaceRole | null
}> {
  const nsStore = repo.namespacesSnapshot()
  const members = repo.membersSnapshot()
  const admin = isInstanceAdmin(user)
  const out: Array<{
    name: string
    basePermission: BasePermission
    membersCanCreateRepos: boolean
    createdAt: string
    memberCount: number
    role: NamespaceRole | null
  }> = []
  for (const [name, settings] of Object.entries(nsStore.namespaces)) {
    const map = members.members[name] ?? {}
    const gMap = members.groupMembers?.[name] ?? {}
    const role = resolveNamespaceRole(name, user)
    if (!admin && !role) continue
    out.push({
      name,
      basePermission: settings.basePermission,
      membersCanCreateRepos: settings.membersCanCreateRepos,
      createdAt: settings.createdAt,
      memberCount: Object.keys(map).length + Object.keys(gMap).length,
      role,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function createNamespaceAuthz(
  actor: SessionUser,
  ns: string,
  basePermission: BasePermission,
  membersCanCreateRepos = true,
): { ok: true } | { ok: false; error: string } {
  const name = ns.trim()
  if (!name) return { ok: false, error: 'Namespace name required' }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return { ok: false, error: 'Invalid namespace name' }
  }
  return repo.createNamespace(userKey(actor), name, basePermission, membersCanCreateRepos)
}

/** Seed namespace if missing (instance admin / create_namespace on first repo). */
export function ensureNamespaceForCreate(
  actor: SessionUser,
  ns: string,
  basePermission: BasePermission = 'none',
): void {
  repo.ensureNamespace(userKey(actor), ns, basePermission)
}

export function updateNamespaceSettings(
  ns: string,
  patch: Partial<{
    basePermission: BasePermission
    membersCanCreateRepos: boolean
  }>,
): { ok: true } | { ok: false; error: string } {
  return repo.updateNamespaceSettings(ns, patch)
}

/** Remove AuthZ namespace settings, members, custom roles, and all repo collaborators under ns. */
export function deleteNamespaceAuthz(
  ns: string,
): { ok: true } | { ok: false; error: string } {
  return repo.deleteNamespace(ns)
}
