import { can, matchesIdentityEntry } from './principal.js'
import { join } from 'node:path'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
import type { SessionUser } from './session.js'
import {
  ALL_INSTANCE_PERMISSIONS,
  isPredefinedNsRole,
  isPredefinedRepoRole,
  maxRepoRole,
  normalizeGroup,
  parseUserKey,
  userKey,
  type BasePermission,
  type CollaboratorPrincipal,
  type CollaboratorRoleRef,
  type InstancePermission,
  type MemberPrincipal,
  type MemberRoleRef,
  type NamespaceCapability,
  type NamespaceRole,
  type RepoRole,
  type UserKey,
} from './authzTypes.js'
import {
  deleteCustomRolesForNamespace,
  getCustomNamespaceRole,
  getCustomRepoRole,
  isValidCollaboratorRole,
  isValidMemberRole,
} from './customRoles.js'

type InstanceStore = {
  version: 1
  /** When true (or AUTHZ_ENFORCE=true), hard gate + repo checks apply. */
  enforce: boolean
  admins: string[] // userKey
  permissions: Record<string, InstancePermission[]> // userKey → perms
  /** Phase 3: userKeys who completed training / GxP onboarding. */
  training?: string[]
}

type NamespacesStore = {
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

type MembersStore = {
  version: 1 | 2
  /** namespace → userKey → role (predefined or custom id) */
  members: Record<string, Record<string, MemberRoleRef>>
  /** namespace → groupKey → role (v2) */
  groupMembers?: Record<string, Record<string, MemberRoleRef>>
}

type CollaboratorsStore = {
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

function readInstance(): InstanceStore {
  const s = readJsonFile(instancePath(), emptyInstance())
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
  writeJsonFile(instancePath(), s)
}

function readNamespaces(): NamespacesStore {
  const s = readJsonFile(namespacesPath(), emptyNamespaces())
  if (!s || s.version !== 1 || !s.namespaces) return emptyNamespaces()
  return s
}

function writeNamespaces(s: NamespacesStore): void {
  writeJsonFile(namespacesPath(), s)
}

function readMembers(): MembersStore {
  const s = readJsonFile(membersPath(), emptyMembers())
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
  writeJsonFile(membersPath(), {
    version: 2,
    members: s.members,
    groupMembers: s.groupMembers ?? {},
  })
}

function readCollaborators(): CollaboratorsStore {
  const s = readJsonFile(collaboratorsPath(), emptyCollaborators())
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
  writeJsonFile(collaboratorsPath(), {
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

function sessionGroups(user: { groups?: string[] }): string[] {
  return (user.groups ?? []).map(normalizeGroup).filter(Boolean)
}

function repoKey(ns: string, repo: string): string {
  return `${ns}/${repo}`
}

function bootstrapAllowlist(): string[] {
  return env.authzBootstrapAdmins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function matchesBootstrap(user: SessionUser): boolean {
  return bootstrapAllowlist().some((entry) => matchesIdentityEntry(entry, user))
}

/** Effective enforce: env override wins; else store flag. */
export function isAuthzEnforce(): boolean {
  if (env.authzEnforce === 'true') return true
  if (env.authzEnforce === 'false') return false
  return readInstance().enforce
}

export function setAuthzEnforce(enforce: boolean): void {
  const s = readInstance()
  s.enforce = enforce
  writeInstance(s)
}

export function isInstanceAdmin(user: UserKey): boolean {
  if (!can(user, 'canBeAdmin')) return false
  return readInstance().admins.includes(userKey(user))
}

export function listInstanceAdmins(): UserKey[] {
  return readInstance().admins.map(parseUserKey)
}

export function instancePermissions(user: UserKey): InstancePermission[] {
  if (isInstanceAdmin(user)) {
    return [...ALL_INSTANCE_PERMISSIONS]
  }
  return readInstance().permissions[userKey(user)] ?? []
}

export function hasInstancePermission(
  user: UserKey,
  perm: InstancePermission,
): boolean {
  return instancePermissions(user).includes(perm)
}

/**
 * Bootstrap instance admin when store has zero admins and user matches
 * AUTHZ_BOOTSTRAP_ADMINS. Enables enforce when env does not force false.
 */
export function maybeBootstrapInstanceAdmin(user: SessionUser): boolean {
  const s = readInstance()
  if (s.admins.length > 0) return false
  if (!matchesBootstrap(user)) return false
  s.admins.push(userKey(user))
  if (env.authzEnforce !== 'false') s.enforce = true
  writeInstance(s)
  return true
}

/**
 * When AUTHZ_DEV_GRANT_ALL is enabled, grant instance admin to every
 * authenticated user (keeps local/e2e usable with enforce on).
 */
export function maybeDevGrantAll(user: SessionUser): void {
  if (!env.authzDevGrantAll) return
  const s = readInstance()
  const key = userKey(user)
  if (s.admins.includes(key)) return
  s.admins.push(key)
  writeInstance(s)
}

export function addInstanceAdmin(actor: UserKey, target: UserKey): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  if (!can(target, 'canBeAdmin')) return { ok: false, error: 'A service principal cannot be an instance admin' }
  const s = readInstance()
  const key = userKey(target)
  if (!s.admins.includes(key)) s.admins.push(key)
  writeInstance(s)
  return { ok: true }
}

export function removeInstanceAdmin(
  actor: UserKey,
  target: UserKey,
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  const s = readInstance()
  if (s.admins.length <= 1 && s.admins.includes(userKey(target))) {
    return { ok: false, error: 'Cannot remove the last instance admin' }
  }
  s.admins = s.admins.filter((k) => k !== userKey(target))
  writeInstance(s)
  return { ok: true }
}

export function setInstancePermissions(
  actor: UserKey,
  target: UserKey,
  perms: InstancePermission[],
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  for (const p of perms) {
    if (!ALL_INSTANCE_PERMISSIONS.includes(p)) {
      return { ok: false, error: `Invalid instance permission: ${p}` }
    }
  }
  writeInstancePermissions(target, perms)
  return { ok: true }
}

/** Internal / bootstrap: set instance permissions without actor check. */
export function writeInstancePermissions(
  target: UserKey,
  perms: InstancePermission[],
): void {
  const s = readInstance()
  const key = userKey(target)
  const cleaned = [
    ...new Set(perms.filter((p) => ALL_INSTANCE_PERMISSIONS.includes(p))),
  ]
  if (cleaned.length === 0) delete s.permissions[key]
  else s.permissions[key] = cleaned
  writeInstance(s)
}

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

/** Users who completed training (Phase 3 gate). */
export function hasCompletedTraining(user: UserKey): boolean {
  const s = readInstance()
  return (s.training ?? []).includes(userKey(user))
}

export function setTrainingCompleted(
  actor: UserKey,
  target: UserKey,
  done: boolean,
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  writeTraining(target, done)
  return { ok: true }
}

/** Self-serve training completion (Phase 3). */
export function setTrainingCompletedSelf(user: UserKey, done: boolean): void {
  writeTraining(user, done)
}

function writeTraining(target: UserKey, done: boolean): void {
  const s = readInstance()
  const set = new Set(s.training ?? [])
  if (done) set.add(userKey(target))
  else set.delete(userKey(target))
  s.training = [...set]
  writeInstance(s)
}

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

export function isCustomRepoRoleAssigned(ns: string, roleId: string): boolean {
  const collab = readCollaborators()
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

export function listInstancePermissionGrants(): Array<{
  sub: string
  iss: string
  permissions: InstancePermission[]
}> {
  return Object.entries(readInstance().permissions).map(([key, permissions]) => {
    const u = parseUserKey(key)
    return { sub: u.sub, iss: u.iss, permissions }
  })
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

export function getRepoCollaboratorRoleRef(
  ns: string,
  repo: string,
  user: UserKey,
): CollaboratorRoleRef | null {
  return (
    readCollaborators().collaborators[repoKey(ns, repo)]?.[userKey(user)] ??
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
    readCollaborators().groupCollaborators?.[repoKey(ns, repo)] ?? {}
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
    readCollaborators().groupCollaborators?.[repoKey(ns, repo)] ?? {}
  for (const g of sessionGroups(user)) {
    const r = map[g]
    if (r && !isPredefinedRepoRole(r) && getCustomRepoRole(ns, r)) ids.push(r)
  }
  return ids
}

export function listRepoCollaborators(
  ns: string,
  repo: string,
): CollaboratorPrincipal[] {
  const store = readCollaborators()
  const key = repoKey(ns, repo)
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
  const store = readCollaborators()
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
  repo: string,
  target: UserKey,
  role: CollaboratorRoleRef,
): { ok: true } | { ok: false; error: string } {
  if (!isValidCollaboratorRole(ns, role)) {
    return { ok: false, error: 'Invalid role' }
  }
  const store = readCollaborators()
  const key = repoKey(ns, repo)
  if (!store.collaborators[key]) store.collaborators[key] = {}
  if (!store.groupCollaborators) store.groupCollaborators = {}
  store.collaborators[key][userKey(target)] = role
  writeCollaborators(store)
  return { ok: true }
}

export function removeRepoCollaborator(
  ns: string,
  repo: string,
  target: UserKey,
): boolean {
  const store = readCollaborators()
  const key = repoKey(ns, repo)
  const map = store.collaborators[key]
  if (!map || !map[userKey(target)]) return false
  delete map[userKey(target)]
  writeCollaborators(store)
  return true
}

export function setRepoGroupCollaborator(
  ns: string,
  repo: string,
  group: string,
  role: CollaboratorRoleRef,
): { ok: true } | { ok: false; error: string } {
  if (!isValidCollaboratorRole(ns, role)) {
    return { ok: false, error: 'Invalid role' }
  }
  const g = normalizeGroup(group)
  if (!g) return { ok: false, error: 'Group name required' }
  const store = readCollaborators()
  const key = repoKey(ns, repo)
  if (!store.groupCollaborators) store.groupCollaborators = {}
  if (!store.groupCollaborators[key]) store.groupCollaborators[key] = {}
  store.groupCollaborators[key][g] = role
  writeCollaborators(store)
  return { ok: true }
}

export function removeRepoGroupCollaborator(
  ns: string,
  repo: string,
  group: string,
): boolean {
  const g = normalizeGroup(group)
  const store = readCollaborators()
  const key = repoKey(ns, repo)
  const map = store.groupCollaborators?.[key]
  if (!map || !map[g]) return false
  delete map[g]
  writeCollaborators(store)
  return true
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
