import { randomBytes } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from './db/database.js'
import { customNamespaceRoles, customRepoRoles, namespaces } from './db/schema.js'
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

const MAX_ROLES_PER_KIND = 20

export const ALL_NAMESPACE_CAPABILITIES: NamespaceCapability[] = [
  'manage_members',
  'manage_settings',
  'manage_custom_roles',
  'create_repos',
  'view_audit',
  'view_lineage',
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
  'job_submit',
  'job_read',
  'job_cancel',
  'job_complete',
  'lineage_read',
  'lineage_rebuild',
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
  job_submit: 'write',
  job_read: 'read',
  job_cancel: 'write',
  job_complete: 'write',
  lineage_read: 'read',
  lineage_rebuild: 'admin',
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


type NsRow = typeof customNamespaceRoles.$inferSelect
type RepoRow = typeof customRepoRoles.$inferSelect

function toNsRole(r: NsRow): CustomNamespaceRole {
  return {
    id: r.id,
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    permissions: r.permissions as NamespaceCapability[],
    ...(r.baseRepositoryRole ? { baseRepositoryRole: r.baseRepositoryRole as BasePermission } : {}),
  }
}

function toRepoRole(r: RepoRow): CustomRepoRole {
  return {
    id: r.id,
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    base: r.base as CustomRepoRole['base'],
    permissions: r.permissions as RepoFinePermission[],
  }
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })
  return code?.code === '23505' || code?.cause?.code === '23505'
}

async function namespaceIdByName(ns: string): Promise<string | null> {
  const rows = await getDb().select({ id: namespaces.id }).from(namespaces).where(eq(namespaces.name, ns)).limit(1)
  return rows[0]?.id ?? null
}

export async function listCustomNamespaceRoles(ns: string): Promise<CustomNamespaceRole[]> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return []
  const rows = await getDb().select().from(customNamespaceRoles).where(eq(customNamespaceRoles.namespaceId, nsId))
  return rows.map(toNsRole).sort((a, b) => a.name.localeCompare(b.name))
}

export async function listCustomRepoRoles(ns: string): Promise<CustomRepoRole[]> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return []
  const rows = await getDb().select().from(customRepoRoles).where(eq(customRepoRoles.namespaceId, nsId))
  return rows.map(toRepoRole).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCustomNamespaceRole(ns: string, id: string): Promise<CustomNamespaceRole | null> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return null
  const rows = await getDb()
    .select()
    .from(customNamespaceRoles)
    .where(and(eq(customNamespaceRoles.namespaceId, nsId), eq(customNamespaceRoles.id, id)))
    .limit(1)
  return rows[0] ? toNsRole(rows[0]) : null
}

export async function getCustomRepoRole(ns: string, id: string): Promise<CustomRepoRole | null> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return null
  const rows = await getDb()
    .select()
    .from(customRepoRoles)
    .where(and(eq(customRepoRoles.namespaceId, nsId), eq(customRepoRoles.id, id)))
    .limit(1)
  return rows[0] ? toRepoRole(rows[0]) : null
}

async function lockNamespaceRow(tx: Tx, ns: string): Promise<{ id: string } | null> {
  const rows = await tx.select({ id: namespaces.id }).from(namespaces).where(eq(namespaces.name, ns)).for('update')
  return rows[0] ?? null
}

export async function createCustomNamespaceRole(
  ns: string,
  input: {
    name: string
    description?: string
    permissions: NamespaceCapability[]
    baseRepositoryRole?: BasePermission
  },
): Promise<{ ok: true; role: CustomNamespaceRole } | { ok: false; error: string }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name required' }
  const perms = validateNsPerms(input.permissions)
  if ('error' in perms) return { ok: false, error: perms.error }
  const base = input.baseRepositoryRole
  if (base !== undefined && !(base === 'none' || isPredefinedRepoRole(base))) {
    return { ok: false, error: 'Invalid baseRepositoryRole' }
  }
  const role: CustomNamespaceRole = {
    id: randomBytes(8).toString('hex'),
    name,
    ...(input.description?.trim() ? { description: input.description.trim().slice(0, 200) } : {}),
    permissions: perms,
    ...(base !== undefined ? { baseRepositoryRole: base } : {}),
  }
  try {
    return await inTransaction(async (tx) => {
      const locked = await lockNamespaceRow(tx, ns)
      if (!locked) return { ok: false, error: 'Namespace not found' } as const
      const count = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(customNamespaceRoles)
        .where(eq(customNamespaceRoles.namespaceId, locked.id))
      if ((count[0]?.n ?? 0) >= MAX_ROLES_PER_KIND) {
        return { ok: false, error: `At most ${MAX_ROLES_PER_KIND} custom namespace roles` } as const
      }
      await tx.insert(customNamespaceRoles).values({
        id: role.id,
        namespaceId: locked.id,
        name,
        description: role.description ?? null,
        permissions: perms,
        baseRepositoryRole: base ?? null,
      })
      return { ok: true, role } as const
    })
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'Name already in use' }
    throw e
  }
}

export async function updateCustomNamespaceRole(
  ns: string,
  id: string,
  patch: Partial<{
    name: string
    description: string | null
    permissions: NamespaceCapability[]
    baseRepositoryRole: BasePermission | null
  }>,
): Promise<{ ok: true; role: CustomNamespaceRole } | { ok: false; error: string }> {
  const cur = await getCustomNamespaceRole(ns, id)
  if (!cur) return { ok: false, error: 'Not found' }
  const set: Partial<typeof customNamespaceRoles.$inferInsert> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: 'name required' }
    set.name = name
  }
  if (patch.description !== undefined) {
    set.description =
      patch.description === null || patch.description.trim() === '' ? null : patch.description.trim().slice(0, 200)
  }
  if (patch.permissions !== undefined) {
    const perms = validateNsPerms(patch.permissions)
    if ('error' in perms) return { ok: false, error: perms.error }
    set.permissions = perms
  }
  if (patch.baseRepositoryRole !== undefined) {
    const b = patch.baseRepositoryRole
    if (b !== null && b !== 'none' && !isPredefinedRepoRole(b)) {
      return { ok: false, error: 'Invalid baseRepositoryRole' }
    }
    set.baseRepositoryRole = b
  }
  try {
    const nsId = await namespaceIdByName(ns)
    if (!nsId) return { ok: false, error: 'Not found' }
    if (Object.keys(set).length) {
      await getDb()
        .update(customNamespaceRoles)
        .set(set)
        .where(and(eq(customNamespaceRoles.namespaceId, nsId), eq(customNamespaceRoles.id, id)))
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'Name already in use' }
    throw e
  }
  const role = await getCustomNamespaceRole(ns, id)
  return role ? { ok: true, role } : { ok: false, error: 'Not found' }
}

export async function deleteCustomNamespaceRole(
  ns: string,
  id: string,
  assigned: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (assigned) return { ok: false, error: 'Role is still assigned to members' }
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return { ok: false, error: 'Not found' }
  const rows = await getDb()
    .delete(customNamespaceRoles)
    .where(and(eq(customNamespaceRoles.namespaceId, nsId), eq(customNamespaceRoles.id, id)))
    .returning({ id: customNamespaceRoles.id })
  return rows.length ? { ok: true } : { ok: false, error: 'Not found' }
}

export async function createCustomRepoRole(
  ns: string,
  input: {
    name: string
    description?: string
    base: CustomRepoRole['base']
    permissions: RepoFinePermission[]
  },
): Promise<{ ok: true; role: CustomRepoRole } | { ok: false; error: string }> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'name required' }
  if (!['read', 'triage', 'write', 'maintain'].includes(input.base)) {
    return { ok: false, error: 'base must be read|triage|write|maintain' }
  }
  const perms = validateRepoFines(input.permissions)
  if ('error' in perms) return { ok: false, error: perms.error }
  const role: CustomRepoRole = {
    id: randomBytes(8).toString('hex'),
    name,
    ...(input.description?.trim() ? { description: input.description.trim().slice(0, 200) } : {}),
    base: input.base,
    permissions: filterRedundantRepoFines(input.base, perms),
  }
  try {
    return await inTransaction(async (tx) => {
      const locked = await lockNamespaceRow(tx, ns)
      if (!locked) return { ok: false, error: 'Namespace not found' } as const
      const count = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(customRepoRoles)
        .where(eq(customRepoRoles.namespaceId, locked.id))
      if ((count[0]?.n ?? 0) >= MAX_ROLES_PER_KIND) {
        return { ok: false, error: `At most ${MAX_ROLES_PER_KIND} custom repo roles` } as const
      }
      await tx.insert(customRepoRoles).values({
        id: role.id,
        namespaceId: locked.id,
        name,
        description: role.description ?? null,
        base: role.base,
        permissions: role.permissions,
      })
      return { ok: true, role } as const
    })
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'Name already in use' }
    throw e
  }
}

export async function updateCustomRepoRole(
  ns: string,
  id: string,
  patch: Partial<{
    name: string
    description: string | null
    base: CustomRepoRole['base']
    permissions: RepoFinePermission[]
  }>,
): Promise<{ ok: true; role: CustomRepoRole } | { ok: false; error: string }> {
  const cur = await getCustomRepoRole(ns, id)
  if (!cur) return { ok: false, error: 'Not found' }
  const set: Partial<typeof customRepoRoles.$inferInsert> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return { ok: false, error: 'name required' }
    set.name = name
  }
  if (patch.description !== undefined) {
    set.description =
      patch.description === null || patch.description.trim() === '' ? null : patch.description.trim().slice(0, 200)
  }
  let base = cur.base
  if (patch.base !== undefined) {
    if (!['read', 'triage', 'write', 'maintain'].includes(patch.base)) {
      return { ok: false, error: 'base must be read|triage|write|maintain' }
    }
    base = patch.base
    set.base = base
  }
  if (patch.permissions !== undefined) {
    const perms = validateRepoFines(patch.permissions)
    if ('error' in perms) return { ok: false, error: perms.error }
    set.permissions = filterRedundantRepoFines(base, perms)
  } else if (patch.base !== undefined) {
    set.permissions = filterRedundantRepoFines(base, cur.permissions)
  }
  try {
    const nsId = await namespaceIdByName(ns)
    if (!nsId) return { ok: false, error: 'Not found' }
    if (Object.keys(set).length) {
      await getDb()
        .update(customRepoRoles)
        .set(set)
        .where(and(eq(customRepoRoles.namespaceId, nsId), eq(customRepoRoles.id, id)))
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'Name already in use' }
    throw e
  }
  const role = await getCustomRepoRole(ns, id)
  return role ? { ok: true, role } : { ok: false, error: 'Not found' }
}

export async function deleteCustomRepoRole(
  ns: string,
  id: string,
  assigned: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (assigned) return { ok: false, error: 'Role is still assigned to collaborators' }
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return { ok: false, error: 'Not found' }
  const rows = await getDb()
    .delete(customRepoRoles)
    .where(and(eq(customRepoRoles.namespaceId, nsId), eq(customRepoRoles.id, id)))
    .returning({ id: customRepoRoles.id })
  return rows.length ? { ok: true } : { ok: false, error: 'Not found' }
}

export async function isValidMemberRole(ns: string, role: string): Promise<boolean> {
  if (isPredefinedNsRole(role)) return true
  return Boolean(await getCustomNamespaceRole(ns, role))
}

export async function isValidCollaboratorRole(ns: string, role: string): Promise<boolean> {
  if (isPredefinedRepoRole(role)) return true
  return Boolean(await getCustomRepoRole(ns, role))
}

/** Map oxen/audit action (+ method) to a fine permission. */
export function finePermissionForAction(
  method: string,
  action: string,
): RepoFinePermission | null {
  const m = method.toUpperCase()
  // Product actions first so GET job.read / lineage.read are not collapsed to contents_read.
  if (action === 'repo.delete') return 'repo_delete'
  if (action === 'repo.metadata') return 'manage_repo_metadata'
  if (action === 'meta.set') return 'manage_repo_metadata'
  if (action === 'merge') return 'merge'
  if (action === 'branch.delete') return 'delete_branch'
  if (
    action === 'file.write' ||
    action === 'file.delete' ||
    action === 'branch.create' ||
    action === 'branch.update' ||
    action === 'push'
  ) {
    return 'contents_write'
  }
  if (action === 'versions.query') return 'contents_read'
  if (action.startsWith('workspace')) return 'workspaces'
  if (action === 'job.submit') return 'job_submit'
  if (action === 'job.read') return 'job_read'
  if (action === 'job.cancel') return 'job_cancel'
  if (action === 'job.complete' || action === 'job.publish' || action === 'job.sync') {
    return 'job_complete'
  }
  if (action === 'lineage.read') return 'lineage_read'
  if (action === 'lineage.rebuild') return 'lineage_rebuild'
  if (action === 'repo.create') return null // namespace-gated
  if (m === 'GET' || m === 'HEAD') return 'contents_read'
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
