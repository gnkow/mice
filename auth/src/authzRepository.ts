import type { SessionUser } from './session.js'
import { matchesIdentityEntry } from './principal.js'
import { join } from 'node:path'
import { deleteCustomRolesForNamespace } from './customRoles.js'
import { env } from './env.js'
import { createDocumentStore } from './stores.js'
import { normalizeGroup, userKey, type BasePermission, type CollaboratorRoleRef, type InstancePermission, type MemberRoleRef } from './authzTypes.js'

export type InstanceStore = {
  version: 1
  /** When true (or AUTHZ_ENFORCE=true), hard gate + repo checks apply. */
  enforce: boolean
  admins: string[] // userKey
  permissions: Record<string, InstancePermission[]> // userKey → perms
  /** Phase 3: userKeys who completed training / GxP onboarding. */
  training?: string[]
}

export type NamespacesStore = {
  version: 1
  namespaces: Record<
    string,
    {
      basePermission: BasePermission
      membersCanCreateRepos: boolean
      createdAt: string
      createdBy: string
    }
  >
}

export type MembersStore = {
  version: 1 | 2
  /** namespace → userKey → role (predefined or custom id) */
  members: Record<string, Record<string, MemberRoleRef>>
  /** namespace → groupKey → role (v2) */
  groupMembers?: Record<string, Record<string, MemberRoleRef>>
}

export type CollaboratorsStore = {
  version: 1 | 2
  /** `${ns}/${repo}` → userKey → role (predefined or custom id) */
  collaborators: Record<string, Record<string, CollaboratorRoleRef>>
  /** `${ns}/${repo}` → groupKey → role (v2) */
  groupCollaborators?: Record<string, Record<string, CollaboratorRoleRef>>
}

function instancePath() {
  return join(env.dataDir, 'instance-admins.json')
}

function namespacesPath() {
  return join(env.dataDir, 'namespaces.json')
}

function membersPath() {
  return join(env.dataDir, 'namespace-members.json')
}

function collaboratorsPath() {
  return join(env.dataDir, 'repo-collaborators.json')
}

function emptyInstance(): InstanceStore {
  return { version: 1, enforce: false, admins: [], permissions: {}, training: [] }
}

function emptyNamespaces(): NamespacesStore {
  return { version: 1, namespaces: {} }
}

function emptyMembers(): MembersStore {
  return { version: 2, members: {}, groupMembers: {} }
}

function emptyCollaborators(): CollaboratorsStore {
  return { version: 2, collaborators: {}, groupCollaborators: {} }
}

const instanceDoc = createDocumentStore<InstanceStore>({ path: instancePath, initial: emptyInstance, onCorrupt: 'initial' })
const namespacesDoc = createDocumentStore<NamespacesStore>({ path: namespacesPath, initial: emptyNamespaces, onCorrupt: 'initial' })
const membersDoc = createDocumentStore<MembersStore>({ path: membersPath, initial: emptyMembers, onCorrupt: 'initial' })
const collaboratorsDoc = createDocumentStore<CollaboratorsStore>({ path: collaboratorsPath, initial: emptyCollaborators, onCorrupt: 'initial' })

function readInstance(): InstanceStore {
  const s = instanceDoc.read()
  if (!s || s.version !== 1) return emptyInstance()
  return {
    version: 1,
    enforce: Boolean(s.enforce),
    admins: Array.isArray(s.admins) ? s.admins : [],
    permissions:
      s.permissions && typeof s.permissions === 'object' ? s.permissions : {},
    training: Array.isArray(s.training) ? s.training : [],
  }
}

function writeInstance(s: InstanceStore): void {
  instanceDoc.write(s)
}

function readNamespaces(): NamespacesStore {
  const s = namespacesDoc.read()
  if (!s || s.version !== 1 || !s.namespaces) return emptyNamespaces()
  return s
}

function writeNamespaces(s: NamespacesStore): void {
  namespacesDoc.write(s)
}

function readMembers(): MembersStore {
  const s = membersDoc.read()
  if (!s || (s.version !== 1 && s.version !== 2) || !s.members) {
    return emptyMembers()
  }
  return {
    version: 2,
    members: s.members,
    groupMembers:
      s.groupMembers && typeof s.groupMembers === 'object'
        ? s.groupMembers
        : {},
  }
}

function writeMembers(s: MembersStore): void {
  membersDoc.write({
    version: 2,
    members: s.members,
    groupMembers: s.groupMembers ?? {},
  })
}

function readCollaborators(): CollaboratorsStore {
  const s = collaboratorsDoc.read()
  if (!s || (s.version !== 1 && s.version !== 2) || !s.collaborators) {
    return emptyCollaborators()
  }
  return {
    version: 2,
    collaborators: s.collaborators,
    groupCollaborators:
      s.groupCollaborators && typeof s.groupCollaborators === 'object'
        ? s.groupCollaborators
        : {},
  }
}

function writeCollaborators(s: CollaboratorsStore): void {
  collaboratorsDoc.write({
    version: 2,
    collaborators: s.collaborators,
    groupCollaborators: s.groupCollaborators ?? {},
  })
}

function countNamespaceOwnersIn(store: MembersStore, ns: string): number {
  const users = Object.values(store.members[ns] ?? {}).filter(
    (r) => r === 'owner',
  ).length
  const groups = Object.values(store.groupMembers?.[ns] ?? {}).filter(
    (r) => r === 'owner',
  ).length
  return users + groups
}

export function sessionGroups(user: { groups?: string[] }): string[] {
  return (user.groups ?? []).map(normalizeGroup).filter(Boolean)
}

export function repoKey(ns: string, repo: string): string {
  return `${ns}/${repo}`
}

export function bootstrapAllowlist(): string[] {
  return env.authzBootstrapAdmins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function matchesBootstrap(user: SessionUser): boolean {
  return bootstrapAllowlist().some((entry) => matchesIdentityEntry(entry, user))
}

type Result = { ok: true } | { ok: false; error: string }

export type NamespaceSettings = NamespacesStore['namespaces'][string]

/** Read-only views of the authz documents. Mutate only through the operations below. */
export function instanceSnapshot(): Readonly<InstanceStore> {
  return readInstance()
}

export function namespacesSnapshot(): Readonly<NamespacesStore> {
  return readNamespaces()
}

export function membersSnapshot(): Readonly<MembersStore> {
  return readMembers()
}

export function collaboratorsSnapshot(): Readonly<CollaboratorsStore> {
  return readCollaborators()
}

export function updateInstance(change: (s: InstanceStore) => void): void {
  const s = readInstance()
  change(s)
  writeInstance(s)
}

/**
 * Write several documents as one unit: if any write throws, documents already
 * written are restored to their previous contents.
 */
function commit(writes: Array<{ apply: () => void; undo: () => void }>): void {
  const done: Array<() => void> = []
  try {
    for (const w of writes) {
      w.apply()
      done.push(w.undo)
    }
  } catch (e) {
    for (const undo of done.reverse()) {
      try {
        undo()
      } catch {
        // best effort: keep restoring the remaining documents
      }
    }
    throw e
  }
}

export function createNamespace(
  creator: string,
  name: string,
  basePermission: BasePermission,
  membersCanCreateRepos: boolean,
): Result {
  const namespaces = readNamespaces()
  if (namespaces.namespaces[name]) return { ok: false, error: 'Namespace already exists' }
  const prevNamespaces = readNamespaces()
  const prevMembers = readMembers()
  namespaces.namespaces[name] = {
    basePermission,
    membersCanCreateRepos,
    createdAt: new Date().toISOString(),
    createdBy: creator,
  }
  const members = readMembers()
  members.members[name] = { [creator]: 'owner' }
  if (!members.groupMembers) members.groupMembers = {}
  members.groupMembers[name] = {}
  commit([
    { apply: () => writeMembers(members), undo: () => writeMembers(prevMembers) },
    { apply: () => writeNamespaces(namespaces), undo: () => writeNamespaces(prevNamespaces) },
  ])
  return { ok: true }
}

/** Seed the namespace if missing and make sure `actor` owns it when seeding. */
export function ensureNamespace(actor: string, name: string, basePermission: BasePermission): void {
  const namespaces = readNamespaces()
  if (namespaces.namespaces[name]) return
  const prevNamespaces = readNamespaces()
  const prevMembers = readMembers()
  namespaces.namespaces[name] = {
    basePermission,
    membersCanCreateRepos: true,
    createdAt: new Date().toISOString(),
    createdBy: actor,
  }
  const members = readMembers()
  if (!members.members[name]) members.members[name] = {}
  if (!members.members[name][actor]) members.members[name][actor] = 'owner'
  commit([
    { apply: () => writeMembers(members), undo: () => writeMembers(prevMembers) },
    { apply: () => writeNamespaces(namespaces), undo: () => writeNamespaces(prevNamespaces) },
  ])
}

export function updateNamespaceSettings(
  name: string,
  patch: Partial<Pick<NamespaceSettings, 'basePermission' | 'membersCanCreateRepos'>>,
): Result {
  const store = readNamespaces()
  const cur = store.namespaces[name]
  if (!cur) return { ok: false, error: 'Namespace not found' }
  if (patch.basePermission !== undefined) cur.basePermission = patch.basePermission
  if (patch.membersCanCreateRepos !== undefined) cur.membersCanCreateRepos = patch.membersCanCreateRepos
  writeNamespaces(store)
  return { ok: true }
}

/**
 * Remove a namespace with its members, collaborators and custom roles as one
 * operation. `hooks.afterCommit` runs before custom roles are removed (failure injection point).
 */
export function deleteNamespace(name: string, hooks: { afterCommit?: () => void } = {}): Result {
  const namespaces = readNamespaces()
  if (!namespaces.namespaces[name]) return { ok: false, error: 'Namespace not found' }
  const prevNamespaces = readNamespaces()
  const prevMembers = readMembers()
  const prevCollab = readCollaborators()

  delete namespaces.namespaces[name]
  const members = readMembers()
  delete members.members[name]
  if (members.groupMembers) delete members.groupMembers[name]
  const collab = readCollaborators()
  const prefix = `${name}/`
  const owned = (key: string) => key.startsWith(prefix) || key === name
  for (const key of Object.keys(collab.collaborators)) {
    if (owned(key)) delete collab.collaborators[key]
  }
  for (const key of Object.keys(collab.groupCollaborators ?? {})) {
    if (owned(key)) delete collab.groupCollaborators![key]
  }

  commit([
    { apply: () => writeMembers(members), undo: () => writeMembers(prevMembers) },
    { apply: () => writeCollaborators(collab), undo: () => writeCollaborators(prevCollab) },
    { apply: () => writeNamespaces(namespaces), undo: () => writeNamespaces(prevNamespaces) },
    {
      apply: () => {
        hooks.afterCommit?.()
        deleteCustomRolesForNamespace(name)
      },
      undo: () => {},
    },
  ])
  return { ok: true }
}

export function setMember(ns: string, key: string, role: MemberRoleRef): Result {
  const members = readMembers()
  if (!readNamespaces().namespaces[ns]) return { ok: false, error: 'Namespace not found' }
  if (!members.members[ns]) members.members[ns] = {}
  if (!members.groupMembers) members.groupMembers = {}
  const map = members.members[ns]
  const prev = map[key]
  map[key] = role
  if (prev === 'owner' && role !== 'owner' && countNamespaceOwnersIn(members, ns) === 0) {
    return { ok: false, error: 'Cannot demote the last namespace Owner' }
  }
  writeMembers(members)
  return { ok: true }
}

export function removeMember(ns: string, key: string): Result {
  const members = readMembers()
  const map = members.members[ns]
  if (!map) return { ok: false, error: 'Namespace not found' }
  if (map[key] === 'owner' && countNamespaceOwnersIn(members, ns) <= 1) {
    return { ok: false, error: 'Cannot remove the last namespace Owner' }
  }
  delete map[key]
  writeMembers(members)
  return { ok: true }
}

export function setGroupMember(ns: string, group: string, role: MemberRoleRef): Result {
  const members = readMembers()
  if (!readNamespaces().namespaces[ns]) return { ok: false, error: 'Namespace not found' }
  if (!members.groupMembers) members.groupMembers = {}
  if (!members.groupMembers[ns]) members.groupMembers[ns] = {}
  const map = members.groupMembers[ns]
  const prev = map[group]
  map[group] = role
  if (prev === 'owner' && role !== 'owner' && countNamespaceOwnersIn(members, ns) === 0) {
    return { ok: false, error: 'Cannot demote the last namespace Owner' }
  }
  writeMembers(members)
  return { ok: true }
}

export function removeGroupMember(ns: string, group: string): Result {
  const members = readMembers()
  const map = members.groupMembers?.[ns]
  if (!map || !map[group]) return { ok: false, error: 'Group member not found' }
  if (map[group] === 'owner' && countNamespaceOwnersIn(members, ns) <= 1) {
    return { ok: false, error: 'Cannot remove the last namespace Owner' }
  }
  delete map[group]
  writeMembers(members)
  return { ok: true }
}

export function setCollaborator(ns: string, repo: string, key: string, role: CollaboratorRoleRef): void {
  const store = readCollaborators()
  const rk = repoKey(ns, repo)
  if (!store.collaborators[rk]) store.collaborators[rk] = {}
  store.collaborators[rk][key] = role
  writeCollaborators(store)
}

export function removeCollaborator(ns: string, repo: string, key: string): boolean {
  const store = readCollaborators()
  const map = store.collaborators[repoKey(ns, repo)]
  if (!map || !map[key]) return false
  delete map[key]
  writeCollaborators(store)
  return true
}

export function setGroupCollaborator(ns: string, repo: string, group: string, role: CollaboratorRoleRef): void {
  const store = readCollaborators()
  const rk = repoKey(ns, repo)
  if (!store.groupCollaborators) store.groupCollaborators = {}
  if (!store.groupCollaborators[rk]) store.groupCollaborators[rk] = {}
  store.groupCollaborators[rk][group] = role
  writeCollaborators(store)
}

export function removeGroupCollaborator(ns: string, repo: string, group: string): boolean {
  const store = readCollaborators()
  const map = store.groupCollaborators?.[repoKey(ns, repo)]
  if (!map || !map[group]) return false
  delete map[group]
  writeCollaborators(store)
  return true
}
