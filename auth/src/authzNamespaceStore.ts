import type { SessionUser } from './session.js'
import { userKey, type BasePermission, type NamespaceRole, type UserKey } from './authzTypes.js'
import { deleteCustomRolesForNamespace } from './customRoles.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
import { resolveNamespaceRole } from './authzMembershipStore.js'
import { readCollaborators, readMembers, readNamespaces, writeCollaborators, writeMembers, writeNamespaces } from './authzStoreFiles.js'

export function getNamespace(ns: string) {
  return readNamespaces().namespaces[ns] ?? null
}

export function listNamespacesAuthz() {
  return readNamespaces().namespaces
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
  const nsStore = readNamespaces()
  const members = readMembers()
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
  const store = readNamespaces()
  if (store.namespaces[name]) return { ok: false, error: 'Namespace already exists' }
  store.namespaces[name] = {
    basePermission,
    membersCanCreateRepos,
    createdAt: new Date().toISOString(),
    createdBy: userKey(actor),
  }
  writeNamespaces(store)
  const members = readMembers()
  members.members[name] = { [userKey(actor)]: 'owner' }
  if (!members.groupMembers) members.groupMembers = {}
  if (!members.groupMembers[name]) members.groupMembers[name] = {}
  writeMembers(members)
  return { ok: true }
}

/** Seed namespace if missing (instance admin / create_namespace on first repo). */
export function ensureNamespaceForCreate(
  actor: SessionUser,
  ns: string,
  basePermission: BasePermission = 'none',
): void {
  const store = readNamespaces()
  if (store.namespaces[ns]) return
  store.namespaces[ns] = {
    basePermission,
    membersCanCreateRepos: true,
    createdAt: new Date().toISOString(),
    createdBy: userKey(actor),
  }
  writeNamespaces(store)
  const members = readMembers()
  if (!members.members[ns]) members.members[ns] = {}
  if (!members.members[ns][userKey(actor)]) {
    members.members[ns][userKey(actor)] = 'owner'
  }
  writeMembers(members)
}

export function updateNamespaceSettings(
  ns: string,
  patch: Partial<{
    basePermission: BasePermission
    membersCanCreateRepos: boolean
  }>,
): { ok: true } | { ok: false; error: string } {
  const store = readNamespaces()
  const cur = store.namespaces[ns]
  if (!cur) return { ok: false, error: 'Namespace not found' }
  if (patch.basePermission !== undefined) cur.basePermission = patch.basePermission
  if (patch.membersCanCreateRepos !== undefined) {
    cur.membersCanCreateRepos = patch.membersCanCreateRepos
  }
  writeNamespaces(store)
  return { ok: true }
}

/** Remove AuthZ namespace settings, members, and all repo collaborators under ns. */
export function deleteNamespaceAuthz(
  ns: string,
): { ok: true } | { ok: false; error: string } {
  const store = readNamespaces()
  if (!store.namespaces[ns]) return { ok: false, error: 'Namespace not found' }
  delete store.namespaces[ns]
  writeNamespaces(store)

  const members = readMembers()
  delete members.members[ns]
  if (members.groupMembers) delete members.groupMembers[ns]
  writeMembers(members)

  const collab = readCollaborators()
  const prefix = `${ns}/`
  for (const key of Object.keys(collab.collaborators)) {
    if (key.startsWith(prefix) || key === ns) {
      delete collab.collaborators[key]
    }
  }
  if (collab.groupCollaborators) {
    for (const key of Object.keys(collab.groupCollaborators)) {
      if (key.startsWith(prefix) || key === ns) {
        delete collab.groupCollaborators[key]
      }
    }
  }
  writeCollaborators(collab)
  deleteCustomRolesForNamespace(ns)
  return { ok: true }
}
