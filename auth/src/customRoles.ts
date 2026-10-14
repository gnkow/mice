import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
import {
  REPO_ROLE_RANK,
  isPredefinedNsRole,
  isPredefinedRepoRole,
  type BasePermission,
  type NamespaceCapability,
  type RepoFinePermission,
  type RepoRole,
} from './authzTypes.js'

export type CustomNamespaceRole = {
  id: string
  name: string
  description?: string
  permissions: NamespaceCapability[]
  /** Optional inherited repo base for role holders (additive with ns base). */
  baseRepositoryRole?: BasePermission
}

export type CustomRepoRole = {
  id: string
  name: string
  description?: string
  /** Inherited predefined role (not admin). */
  base: 'read' | 'triage' | 'write' | 'maintain'
  permissions: RepoFinePermission[]
}

type NsCustomRoles = {
  namespaceRoles: Record<string, CustomNamespaceRole>
  repoRoles: Record<string, CustomRepoRole>
}

type Store = {
  version: 1
  namespaces: Record<string, NsCustomRoles>
}

const MAX_ROLES_PER_KIND = 20

export const ALL_NAMESPACE_CAPABILITIES: NamespaceCapability[] = [
  'manage_members',
  'manage_settings',
  'manage_custom_roles',
  'create_repos',
  'view_audit',
  'review_access_requests',
  'delete_namespace',
]

export const ALL_REPO_FINE_PERMISSIONS: RepoFinePermission[] = [
  'contents_read',
  'contents_write',
  'workspaces',
  'merge',
  'delete_branch',
  'manage_collaborators',
  'manage_repo_metadata',
  'repo_delete',
  'other_mutate',
]

/** Minimum predefined role that already implies each fine permission. */
export const REPO_FINE_IMPLIED_MIN: Record<RepoFinePermission, RepoRole> = {
  contents_read: 'read',
  contents_write: 'write',
  workspaces: 'write',
  merge: 'maintain',
  delete_branch: 'maintain',
  manage_collaborators: 'admin',
  manage_repo_metadata: 'admin',
  repo_delete: 'admin',
  other_mutate: 'admin',
}

function path() {
  return join(env.dataDir, 'custom-roles.json')
}

function empty(): Store {
  return { version: 1, namespaces: {} }
}

function emptyNs(): NsCustomRoles {
  return { namespaceRoles: {}, repoRoles: {} }
}

function read(): Store {
  const s = readJsonFile(path(), empty())
  if (!s || s.version !== 1 || !s.namespaces) return empty()
  return s
}

function write(s: Store) {
  writeJsonFile(path(), s)
}

function ensureNs(store: Store, ns: string): NsCustomRoles {
  if (!store.namespaces[ns]) store.namespaces[ns] = emptyNs()
  return store.namespaces[ns]
}

export function listCustomNamespaceRoles(ns: string): CustomNamespaceRole[] {
  const roles = read().namespaces[ns]?.namespaceRoles ?? {}
  return Object.values(roles).sort((a, b) => a.name.localeCompare(b.name))
}

export function listCustomRepoRoles(ns: string): CustomRepoRole[] {
  const roles = read().namespaces[ns]?.repoRoles ?? {}
  return Object.values(roles).sort((a, b) => a.name.localeCompare(b.name))
}

export function getCustomNamespaceRole(
  ns: string,
  id: string,
): CustomNamespaceRole | null {
  return read().namespaces[ns]?.namespaceRoles[id] ?? null
}

export function getCustomRepoRole(ns: string, id: string): CustomRepoRole | null {
  return read().namespaces[ns]?.repoRoles[id] ?? null
}

function slugName(name: string): string {
  return name.trim().toLowerCase()
}

function validateNsPerms(
  perms: unknown,
): NamespaceCapability[] | { error: string } {
  if (!Array.isArray(perms)) return { error: 'permissions required' }
  const out: NamespaceCapability[] = []
  for (const p of perms) {
    if (typeof p !== 'string' || !ALL_NAMESPACE_CAPABILITIES.includes(p as NamespaceCapability)) {
      return { error: `Invalid namespace permission: ${String(p)}` }
    }
    out.push(p as NamespaceCapability)
  }
  return [...new Set(out)]
}

function validateRepoFines(
  perms: unknown,
): RepoFinePermission[] | { error: string } {
  if (!Array.isArray(perms)) return { error: 'permissions required' }
  const out: RepoFinePermission[] = []
  for (const p of perms) {
    if (
      typeof p !== 'string' ||
      !ALL_REPO_FINE_PERMISSIONS.includes(p as RepoFinePermission)
    ) {
      return { error: `Invalid repo permission: ${String(p)}` }
    }
    out.push(p as RepoFinePermission)
  }
  return [...new Set(out)]
}

/** Drop fine perms already implied by base. */
export function filterRedundantRepoFines(
  base: CustomRepoRole['base'],
  perms: RepoFinePermission[],
): RepoFinePermission[] {
  return perms.filter(
    (p) => REPO_ROLE_RANK[base] < REPO_ROLE_RANK[REPO_FINE_IMPLIED_MIN[p]],
  )
}

export function createCustomNamespaceRole(
  ns: string,
  input: {
    name: string
    description?: string
    permissions: NamespaceCapability[]
    baseRepositoryRole?: BasePermission
  },
): { ok: true; role: CustomNamespaceRole } | { ok: false; error: string } {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name required' }
  const perms = validateNsPerms(input.permissions)
  if ('error' in perms) return { ok: false, error: perms.error }
  const store = read()
  const bucket = ensureNs(store, ns)
  if (Object.keys(bucket.namespaceRoles).length >= MAX_ROLES_PER_KIND) {
    return { ok: false, error: `At most ${MAX_ROLES_PER_KIND} custom namespace roles` }
  }
  if (
    Object.values(bucket.namespaceRoles).some(
      (r) => slugName(r.name) === slugName(name),
    )
  ) {
    return { ok: false, error: 'Name already in use' }
  }
  let baseRepositoryRole = input.baseRepositoryRole
  if (baseRepositoryRole !== undefined) {
    const ok =
      baseRepositoryRole === 'none' || isPredefinedRepoRole(baseRepositoryRole)
    if (!ok) return { ok: false, error: 'Invalid baseRepositoryRole' }
  }
  const role: CustomNamespaceRole = {
    id: randomBytes(8).toString('hex'),
    name,
    ...(input.description?.trim()
      ? { description: input.description.trim().slice(0, 200) }
      : {}),
    permissions: perms,
    ...(baseRepositoryRole !== undefined ? { baseRepositoryRole } : {}),
  }
  bucket.namespaceRoles[role.id] = role
  write(store)
  return { ok: true, role }
}

export function updateCustomNamespaceRole(
  ns: string,
  id: string,
  patch: Partial<{
    name: string
    description: string | null
    permissions: NamespaceCapability[]
    baseRepositoryRole: BasePermission | null
  }>,
): { ok: true; role: CustomNamespaceRole } | { ok: false; error: string } {
  const store = read()
  const bucket = store.namespaces[ns]
  const role = bucket?.namespaceRoles[id]
  if (!role) return { ok: false, error: 'Not found' }
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: 'name required' }
    if (
      Object.values(bucket.namespaceRoles).some(
        (r) => r.id !== id && slugName(r.name) === slugName(name),
      )
    ) {
      return { ok: false, error: 'Name already in use' }
    }
    role.name = name
  }
  if (patch.description !== undefined) {
    if (patch.description === null || patch.description.trim() === '') {
      delete role.description
    } else {
      role.description = patch.description.trim().slice(0, 200)
    }
  }
  if (patch.permissions !== undefined) {
    const perms = validateNsPerms(patch.permissions)
    if ('error' in perms) return { ok: false, error: perms.error }
    role.permissions = perms
  }
  if (patch.baseRepositoryRole !== undefined) {
    if (patch.baseRepositoryRole === null) {
      delete role.baseRepositoryRole
    } else {
      const b = patch.baseRepositoryRole
      if (b !== 'none' && !isPredefinedRepoRole(b)) {
        return { ok: false, error: 'Invalid baseRepositoryRole' }
      }
      role.baseRepositoryRole = b
    }
  }
  write(store)
  return { ok: true, role }
}

export function deleteCustomNamespaceRole(
  ns: string,
  id: string,
  assigned: boolean,
): { ok: true } | { ok: false; error: string } {
  if (assigned) {
    return { ok: false, error: 'Role is still assigned to members' }
  }
  const store = read()
  const bucket = store.namespaces[ns]
  if (!bucket?.namespaceRoles[id]) return { ok: false, error: 'Not found' }
  delete bucket.namespaceRoles[id]
  write(store)
  return { ok: true }
}

export function createCustomRepoRole(
  ns: string,
  input: {
    name: string
    description?: string
    base: CustomRepoRole['base']
    permissions: RepoFinePermission[]
  },
): { ok: true; role: CustomRepoRole } | { ok: false; error: string } {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name required' }
  if (!['read', 'triage', 'write', 'maintain'].includes(input.base)) {
    return { ok: false, error: 'base must be read|triage|write|maintain' }
  }
  const perms = validateRepoFines(input.permissions)
  if ('error' in perms) return { ok: false, error: perms.error }
  const store = read()
  const bucket = ensureNs(store, ns)
  if (Object.keys(bucket.repoRoles).length >= MAX_ROLES_PER_KIND) {
    return { ok: false, error: `At most ${MAX_ROLES_PER_KIND} custom repo roles` }
  }
  if (
    Object.values(bucket.repoRoles).some(
      (r) => slugName(r.name) === slugName(name),
    )
  ) {
    return { ok: false, error: 'Name already in use' }
  }
  const role: CustomRepoRole = {
    id: randomBytes(8).toString('hex'),
    name,
    ...(input.description?.trim()
      ? { description: input.description.trim().slice(0, 200) }
      : {}),
    base: input.base,
    permissions: filterRedundantRepoFines(input.base, perms),
  }
  bucket.repoRoles[role.id] = role
  write(store)
  return { ok: true, role }
}

export function updateCustomRepoRole(
  ns: string,
  id: string,
  patch: Partial<{
    name: string
    description: string | null
    base: CustomRepoRole['base']
    permissions: RepoFinePermission[]
  }>,
): { ok: true; role: CustomRepoRole } | { ok: false; error: string } {
  const store = read()
  const bucket = store.namespaces[ns]
  const role = bucket?.repoRoles[id]
  if (!role) return { ok: false, error: 'Not found' }
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: 'name required' }
    if (
      Object.values(bucket.repoRoles).some(
        (r) => r.id !== id && slugName(r.name) === slugName(name),
      )
    ) {
      return { ok: false, error: 'Name already in use' }
    }
    role.name = name
  }
  if (patch.description !== undefined) {
    if (patch.description === null || patch.description.trim() === '') {
      delete role.description
    } else {
      role.description = patch.description.trim().slice(0, 200)
    }
  }
  if (patch.base !== undefined) {
    if (!['read', 'triage', 'write', 'maintain'].includes(patch.base)) {
      return { ok: false, error: 'base must be read|triage|write|maintain' }
    }
    role.base = patch.base
  }
  if (patch.permissions !== undefined) {
    const perms = validateRepoFines(patch.permissions)
    if ('error' in perms) return { ok: false, error: perms.error }
    role.permissions = filterRedundantRepoFines(role.base, perms)
  } else if (patch.base !== undefined) {
    role.permissions = filterRedundantRepoFines(role.base, role.permissions)
  }
  write(store)
  return { ok: true, role }
}

export function deleteCustomRepoRole(
  ns: string,
  id: string,
  assigned: boolean,
): { ok: true } | { ok: false; error: string } {
  if (assigned) {
    return { ok: false, error: 'Role is still assigned to collaborators' }
  }
  const store = read()
  const bucket = store.namespaces[ns]
  if (!bucket?.repoRoles[id]) return { ok: false, error: 'Not found' }
  delete bucket.repoRoles[id]
  write(store)
  return { ok: true }
}

export function deleteCustomRolesForNamespace(ns: string): void {
  const store = read()
  if (!store.namespaces[ns]) return
  delete store.namespaces[ns]
  write(store)
}

export function isValidMemberRole(ns: string, role: string): boolean {
  if (isPredefinedNsRole(role)) return true
  return Boolean(getCustomNamespaceRole(ns, role))
}

export function isValidCollaboratorRole(ns: string, role: string): boolean {
  if (isPredefinedRepoRole(role)) return true
  return Boolean(getCustomRepoRole(ns, role))
}

/** Map oxen/audit action (+ method) to a fine permission. */
export function finePermissionForAction(
  method: string,
  action: string,
): RepoFinePermission | null {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return 'contents_read'
  if (action === 'repo.delete') return 'repo_delete'
  if (action === 'merge') return 'merge'
  if (action === 'branch.delete') return 'delete_branch'
  if (action === 'file.write' || action === 'branch.create' || action === 'branch.update') {
    return 'contents_write'
  }
  if (action.startsWith('workspace')) return 'workspaces'
  if (action === 'repo.create') return null // namespace-gated
  if (m !== 'GET' && m !== 'HEAD') return 'other_mutate'
  return 'contents_read'
}

export function customRepoRoleCoversFine(
  role: CustomRepoRole,
  fine: RepoFinePermission,
): boolean {
  if (REPO_ROLE_RANK[role.base] >= REPO_ROLE_RANK[REPO_FINE_IMPLIED_MIN[fine]]) {
    return true
  }
  return role.permissions.includes(fine)
}
