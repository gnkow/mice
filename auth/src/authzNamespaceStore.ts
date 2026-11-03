import { type SessionUser } from './authentication/index.js'
import { userKey, type BasePermission, type NamespaceRole, type UserKey } from './authzTypes.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
import { namespaceRolesFor } from './authzMembershipStore.js'
import * as repo from './authzRepository.js'

export async function getNamespace(ns: string) {
  return repo.readNamespace(ns)
}

export async function listNamespacesAuthz() {
  return repo.readNamespaces()
}

/** Namespaces visible to the user (member/owner), or all if instance admin. */
export async function listNamespacesForUser(user: UserKey & { groups?: string[] }): Promise<
  Array<{
    id: string
    name: string
    basePermission: BasePermission
    membersCanCreateRepos: boolean
    createdAt: string
    memberCount: number
    role: NamespaceRole | null
  }>
> {
  const all = await repo.readNamespaces()
  const counts = await repo.memberCounts()
  const admin = await isInstanceAdmin(user)
  const roles = await namespaceRolesFor(user)
  const out = []
  for (const [name, settings] of Object.entries(all)) {
    const role = roles.get(name) ?? null
    if (!admin && !role) continue
    out.push({
      id: settings.id,
      name,
      basePermission: settings.basePermission,
      membersCanCreateRepos: settings.membersCanCreateRepos,
      createdAt: settings.createdAt,
      memberCount: counts.get(name) ?? 0,
      role,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function createNamespaceAuthz(
  actor: SessionUser,
  ns: string,
  basePermission: BasePermission,
  membersCanCreateRepos = true,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = ns.trim()
  if (!name) return { ok: false, error: 'Namespace name required' }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return { ok: false, error: 'Invalid namespace name' }
  }
  return repo.createNamespace(userKey(actor), name, basePermission, membersCanCreateRepos)
}

/** Seed namespace if missing (instance admin / create_namespace on first repo). */
export async function ensureNamespaceForCreate(
  actor: SessionUser,
  ns: string,
  basePermission: BasePermission = 'none',
): Promise<void> {
  await repo.ensureNamespace(userKey(actor), ns, basePermission)
}

export async function updateNamespaceSettings(
  ns: string,
  patch: Partial<{ basePermission: BasePermission; membersCanCreateRepos: boolean }>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return repo.updateNamespaceSettings(ns, patch)
}

export async function renameNamespaceAuthz(
  from: string,
  to: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return repo.renameNamespace(from, to)
}

/** Remove the namespace with its members, custom roles and repo collaborators in one statement. */
export async function deleteNamespaceAuthz(ns: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return repo.deleteNamespace(ns)
}
