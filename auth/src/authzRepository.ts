import { and, eq, inArray, sql } from 'drizzle-orm'
import { TransactionRollbackError } from 'drizzle-orm/errors'
import type { SessionUser } from './session.js'
import { matchesIdentityEntry } from './principal.js'
import { env } from './env.js'
import { getDb, inTransaction, type Db, type Tx } from './db/database.js'
import {
  instanceAdmins,
  instancePermissions,
  instanceSettings,
  instanceTraining,
  namespaceGroupMembers,
  namespaceMembers,
  namespaces,
  repoCollaborators,
  repoGroupCollaborators,
} from './db/schema.js'
import {
  normalizeGroup,
  type BasePermission,
  type CollaboratorRoleRef,
  type InstancePermission,
  type MemberRoleRef,
} from './authzTypes.js'

type Exec = Db | Tx

export type NamespaceSettings = {
  basePermission: BasePermission
  membersCanCreateRepos: boolean
  createdAt: string
  createdBy: string
}

type Result = { ok: true } | { ok: false; error: string }

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

// ── Instance ────────────────────────────────────────────────────────────────

export async function storedEnforce(): Promise<boolean> {
  const rows = await getDb().select().from(instanceSettings).limit(1)
  return rows[0]?.enforce ?? false
}

export async function writeEnforce(enforce: boolean, db: Exec = getDb()): Promise<void> {
  await db
    .insert(instanceSettings)
    .values({ id: 1, enforce })
    .onConflictDoUpdate({ target: instanceSettings.id, set: { enforce } })
}

export async function listAdminKeys(): Promise<string[]> {
  return (await getDb().select().from(instanceAdmins)).map((r) => r.userKey)
}

export async function isAdminKey(key: string): Promise<boolean> {
  const rows = await getDb().select().from(instanceAdmins).where(eq(instanceAdmins.userKey, key)).limit(1)
  return rows.length > 0
}

export async function addAdminKey(key: string): Promise<void> {
  await getDb().insert(instanceAdmins).values({ userKey: key }).onConflictDoNothing()
}

/** Removes an admin unless it is the last one. Returns false when refused. */
export async function removeAdminKey(key: string): Promise<boolean> {
  return inTransaction(async (tx) => {
    await tx.execute(sql`lock table instance_admins in share row exclusive mode`)
    const all = await tx.select().from(instanceAdmins)
    if (all.length <= 1 && all.some((r) => r.userKey === key)) return false
    await tx.delete(instanceAdmins).where(eq(instanceAdmins.userKey, key))
    return true
  })
}

/** Makes `key` the first admin only when none exists yet (race-safe). Returns true when it did. */
export async function bootstrapFirstAdmin(key: string, enableEnforce: boolean): Promise<boolean> {
  return inTransaction(async (tx) => {
    await tx.execute(sql`lock table instance_admins in share row exclusive mode`)
    const existing = await tx.select().from(instanceAdmins).limit(1)
    if (existing.length > 0) return false
    await tx.insert(instanceAdmins).values({ userKey: key })
    if (enableEnforce) await writeEnforce(true, tx)
    return true
  })
}

export async function instancePermissionsOf(key: string): Promise<InstancePermission[]> {
  const rows = await getDb().select().from(instancePermissions).where(eq(instancePermissions.userKey, key))
  return rows.map((r) => r.permission as InstancePermission)
}

export async function replaceInstancePermissions(key: string, perms: InstancePermission[]): Promise<void> {
  await inTransaction(async (tx) => {
    await tx.delete(instancePermissions).where(eq(instancePermissions.userKey, key))
    if (perms.length) {
      await tx.insert(instancePermissions).values(perms.map((permission) => ({ userKey: key, permission })))
    }
  })
}

export async function listInstancePermissionRows(): Promise<Array<{ key: string; permissions: InstancePermission[] }>> {
  const rows = await getDb().select().from(instancePermissions)
  const by = new Map<string, InstancePermission[]>()
  for (const r of rows) by.set(r.userKey, [...(by.get(r.userKey) ?? []), r.permission as InstancePermission])
  return [...by].map(([key, permissions]) => ({ key, permissions }))
}

export async function isTrained(key: string): Promise<boolean> {
  const rows = await getDb().select().from(instanceTraining).where(eq(instanceTraining.userKey, key)).limit(1)
  return rows.length > 0
}

export async function writeTrained(key: string, done: boolean): Promise<void> {
  if (done) await getDb().insert(instanceTraining).values({ userKey: key }).onConflictDoNothing()
  else await getDb().delete(instanceTraining).where(eq(instanceTraining.userKey, key))
}

// ── Namespaces ──────────────────────────────────────────────────────────────

function toSettings(r: typeof namespaces.$inferSelect): NamespaceSettings {
  return {
    basePermission: r.basePermission as BasePermission,
    membersCanCreateRepos: r.membersCanCreateRepos,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
  }
}

export async function readNamespace(name: string): Promise<NamespaceSettings | null> {
  const rows = await getDb().select().from(namespaces).where(eq(namespaces.name, name)).limit(1)
  return rows[0] ? toSettings(rows[0]) : null
}

export async function readNamespaces(): Promise<Record<string, NamespaceSettings>> {
  const rows = await getDb().select().from(namespaces)
  return Object.fromEntries(rows.map((r) => [r.name, toSettings(r)]))
}

export async function createNamespace(
  creator: string,
  name: string,
  basePermission: BasePermission,
  membersCanCreateRepos: boolean,
): Promise<Result> {
  return inTransaction(async (tx) => {
    const inserted = await tx
      .insert(namespaces)
      .values({ name, basePermission, membersCanCreateRepos, createdAt: new Date(), createdBy: creator })
      .onConflictDoNothing()
      .returning({ name: namespaces.name })
    if (inserted.length === 0) return { ok: false, error: 'Namespace already exists' } as const
    await tx.insert(namespaceMembers).values({ namespace: name, userKey: creator, role: 'owner' })
    return { ok: true } as const
  })
}

/** Seed the namespace if missing and make `actor` its owner when seeding. */
export async function ensureNamespace(actor: string, name: string, basePermission: BasePermission): Promise<void> {
  await inTransaction(async (tx) => {
    const inserted = await tx
      .insert(namespaces)
      .values({ name, basePermission, membersCanCreateRepos: true, createdAt: new Date(), createdBy: actor })
      .onConflictDoNothing()
      .returning({ name: namespaces.name })
    if (inserted.length === 0) return
    await tx.insert(namespaceMembers).values({ namespace: name, userKey: actor, role: 'owner' }).onConflictDoNothing()
  })
}

export async function updateNamespaceSettings(
  name: string,
  patch: Partial<Pick<NamespaceSettings, 'basePermission' | 'membersCanCreateRepos'>>,
): Promise<Result> {
  const set: Partial<typeof namespaces.$inferInsert> = {}
  if (patch.basePermission !== undefined) set.basePermission = patch.basePermission
  if (patch.membersCanCreateRepos !== undefined) set.membersCanCreateRepos = patch.membersCanCreateRepos
  if (Object.keys(set).length === 0) {
    return (await readNamespace(name)) ? { ok: true } : { ok: false, error: 'Namespace not found' }
  }
  const updated = await getDb().update(namespaces).set(set).where(eq(namespaces.name, name)).returning({ name: namespaces.name })
  return updated.length ? { ok: true } : { ok: false, error: 'Namespace not found' }
}

/** Removes a namespace; members, collaborators and custom roles go with it through foreign keys. */
export async function deleteNamespace(name: string): Promise<Result> {
  const deleted = await getDb().delete(namespaces).where(eq(namespaces.name, name)).returning({ name: namespaces.name })
  return deleted.length ? { ok: true } : { ok: false, error: 'Namespace not found' }
}

// ── Members ─────────────────────────────────────────────────────────────────

async function lockNamespace(tx: Tx, ns: string): Promise<boolean> {
  const rows = await tx.select().from(namespaces).where(eq(namespaces.name, ns)).for('update')
  return rows.length > 0
}

async function ownerCount(tx: Tx, ns: string): Promise<number> {
  const users = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespace, ns), eq(namespaceMembers.role, 'owner')))
  const groups = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(namespaceGroupMembers)
    .where(and(eq(namespaceGroupMembers.namespace, ns), eq(namespaceGroupMembers.role, 'owner')))
  return (users[0]?.n ?? 0) + (groups[0]?.n ?? 0)
}

export async function membershipRefs(
  user: { key: string; groups: string[] },
  ns?: string,
): Promise<Array<{ namespace: string; role: MemberRoleRef }>> {
  const db = getDb()
  const direct = await db
    .select({ namespace: namespaceMembers.namespace, role: namespaceMembers.role })
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.userKey, user.key), ns ? eq(namespaceMembers.namespace, ns) : undefined))
  const viaGroups = user.groups.length
    ? await db
        .select({ namespace: namespaceGroupMembers.namespace, role: namespaceGroupMembers.role })
        .from(namespaceGroupMembers)
        .where(and(inArray(namespaceGroupMembers.groupKey, user.groups), ns ? eq(namespaceGroupMembers.namespace, ns) : undefined))
    : []
  return [...direct, ...viaGroups]
}

export async function directMemberRole(ns: string, key: string): Promise<MemberRoleRef | null> {
  const rows = await getDb()
    .select()
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespace, ns), eq(namespaceMembers.userKey, key)))
    .limit(1)
  return rows[0]?.role ?? null
}

export async function listMemberRows(ns: string): Promise<{
  users: Array<{ key: string; role: MemberRoleRef }>
  groups: Array<{ group: string; role: MemberRoleRef }>
}> {
  const db = getDb()
  const users = await db.select().from(namespaceMembers).where(eq(namespaceMembers.namespace, ns))
  const groups = await db.select().from(namespaceGroupMembers).where(eq(namespaceGroupMembers.namespace, ns))
  return {
    users: users.map((r) => ({ key: r.userKey, role: r.role })),
    groups: groups.map((r) => ({ group: r.groupKey, role: r.role })),
  }
}

export async function memberCounts(): Promise<Map<string, number>> {
  const db = getDb()
  const out = new Map<string, number>()
  const add = (rows: Array<{ namespace: string; n: number }>) => {
    for (const r of rows) out.set(r.namespace, (out.get(r.namespace) ?? 0) + r.n)
  }
  add(
    await db
      .select({ namespace: namespaceMembers.namespace, n: sql<number>`count(*)::int` })
      .from(namespaceMembers)
      .groupBy(namespaceMembers.namespace),
  )
  add(
    await db
      .select({ namespace: namespaceGroupMembers.namespace, n: sql<number>`count(*)::int` })
      .from(namespaceGroupMembers)
      .groupBy(namespaceGroupMembers.namespace),
  )
  return out
}

export async function isMemberRoleAssigned(ns: string, roleId: string): Promise<boolean> {
  const db = getDb()
  const u = await db
    .select()
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespace, ns), eq(namespaceMembers.role, roleId)))
    .limit(1)
  if (u.length) return true
  const g = await db
    .select()
    .from(namespaceGroupMembers)
    .where(and(eq(namespaceGroupMembers.namespace, ns), eq(namespaceGroupMembers.role, roleId)))
    .limit(1)
  return g.length > 0
}

export async function ownedNamespaceNames(user: { key: string; groups: string[] }): Promise<string[]> {
  const refs = await membershipRefs(user)
  return [...new Set(refs.filter((r) => r.role === 'owner').map((r) => r.namespace))]
}

export async function setMember(ns: string, key: string, role: MemberRoleRef): Promise<Result> {
  return inTransaction(async (tx) => {
    if (!(await lockNamespace(tx, ns))) return { ok: false, error: 'Namespace not found' } as const
    const prev = (
      await tx
        .select()
        .from(namespaceMembers)
        .where(and(eq(namespaceMembers.namespace, ns), eq(namespaceMembers.userKey, key)))
    )[0]?.role
    await tx
      .insert(namespaceMembers)
      .values({ namespace: ns, userKey: key, role })
      .onConflictDoUpdate({ target: [namespaceMembers.namespace, namespaceMembers.userKey], set: { role } })
    if (prev === 'owner' && role !== 'owner' && (await ownerCount(tx, ns)) === 0) {
      tx.rollback()
    }
    return { ok: true } as const
  }).catch((e: unknown) => rollbackAs(e, 'Cannot demote the last namespace Owner'))
}

export async function removeMember(ns: string, key: string): Promise<Result> {
  return inTransaction(async (tx) => {
    if (!(await lockNamespace(tx, ns))) return { ok: false, error: 'Namespace not found' } as const
    const cur = (
      await tx
        .select()
        .from(namespaceMembers)
        .where(and(eq(namespaceMembers.namespace, ns), eq(namespaceMembers.userKey, key)))
    )[0]
    if (cur?.role === 'owner' && (await ownerCount(tx, ns)) <= 1) {
      return { ok: false, error: 'Cannot remove the last namespace Owner' } as const
    }
    await tx.delete(namespaceMembers).where(and(eq(namespaceMembers.namespace, ns), eq(namespaceMembers.userKey, key)))
    return { ok: true } as const
  })
}

export async function setGroupMember(ns: string, group: string, role: MemberRoleRef): Promise<Result> {
  return inTransaction(async (tx) => {
    if (!(await lockNamespace(tx, ns))) return { ok: false, error: 'Namespace not found' } as const
    const prev = (
      await tx
        .select()
        .from(namespaceGroupMembers)
        .where(and(eq(namespaceGroupMembers.namespace, ns), eq(namespaceGroupMembers.groupKey, group)))
    )[0]?.role
    await tx
      .insert(namespaceGroupMembers)
      .values({ namespace: ns, groupKey: group, role })
      .onConflictDoUpdate({ target: [namespaceGroupMembers.namespace, namespaceGroupMembers.groupKey], set: { role } })
    if (prev === 'owner' && role !== 'owner' && (await ownerCount(tx, ns)) === 0) {
      tx.rollback()
    }
    return { ok: true } as const
  }).catch((e: unknown) => rollbackAs(e, 'Cannot demote the last namespace Owner'))
}

export async function removeGroupMember(ns: string, group: string): Promise<Result> {
  return inTransaction(async (tx) => {
    await lockNamespace(tx, ns)
    const cur = (
      await tx
        .select()
        .from(namespaceGroupMembers)
        .where(and(eq(namespaceGroupMembers.namespace, ns), eq(namespaceGroupMembers.groupKey, group)))
    )[0]
    if (!cur) return { ok: false, error: 'Group member not found' } as const
    if (cur.role === 'owner' && (await ownerCount(tx, ns)) <= 1) {
      return { ok: false, error: 'Cannot remove the last namespace Owner' } as const
    }
    await tx
      .delete(namespaceGroupMembers)
      .where(and(eq(namespaceGroupMembers.namespace, ns), eq(namespaceGroupMembers.groupKey, group)))
    return { ok: true } as const
  })
}

/** `tx.rollback()` throws a TransactionRollbackError; turn it into the intended refusal. */
function rollbackAs(e: unknown, error: string): Result {
  if (e instanceof TransactionRollbackError) return { ok: false, error }
  throw e
}

// ── Collaborators ───────────────────────────────────────────────────────────

export async function directCollaboratorRole(ns: string, repo: string, key: string): Promise<CollaboratorRoleRef | null> {
  const rows = await getDb()
    .select()
    .from(repoCollaborators)
    .where(and(eq(repoCollaborators.namespace, ns), eq(repoCollaborators.repo, repo), eq(repoCollaborators.userKey, key)))
    .limit(1)
  return rows[0]?.role ?? null
}

export async function groupCollaboratorRoles(
  ns: string,
  repo: string,
  groups: string[],
): Promise<Array<{ group: string; role: CollaboratorRoleRef }>> {
  if (!groups.length) return []
  const rows = await getDb()
    .select()
    .from(repoGroupCollaborators)
    .where(
      and(
        eq(repoGroupCollaborators.namespace, ns),
        eq(repoGroupCollaborators.repo, repo),
        inArray(repoGroupCollaborators.groupKey, groups),
      ),
    )
  return rows.map((r) => ({ group: r.groupKey, role: r.role }))
}

export async function listCollaboratorRows(ns: string, repo: string): Promise<{
  users: Array<{ key: string; role: CollaboratorRoleRef }>
  groups: Array<{ group: string; role: CollaboratorRoleRef }>
}> {
  const db = getDb()
  const users = await db
    .select()
    .from(repoCollaborators)
    .where(and(eq(repoCollaborators.namespace, ns), eq(repoCollaborators.repo, repo)))
  const groups = await db
    .select()
    .from(repoGroupCollaborators)
    .where(and(eq(repoGroupCollaborators.namespace, ns), eq(repoGroupCollaborators.repo, repo)))
  return {
    users: users.map((r) => ({ key: r.userKey, role: r.role })),
    groups: groups.map((r) => ({ group: r.groupKey, role: r.role })),
  }
}

export async function listAllCollaboratorRows(): Promise<{
  users: Array<{ key: string; role: CollaboratorRoleRef }>
  groups: Array<{ group: string; role: CollaboratorRoleRef }>
}> {
  const db = getDb()
  const users = await db.select().from(repoCollaborators)
  const groups = await db.select().from(repoGroupCollaborators)
  return {
    users: users.map((r) => ({ key: r.userKey, role: r.role })),
    groups: groups.map((r) => ({ group: r.groupKey, role: r.role })),
  }
}

export async function isRepoRoleAssigned(ns: string, roleId: string): Promise<boolean> {
  const db = getDb()
  const u = await db
    .select()
    .from(repoCollaborators)
    .where(and(eq(repoCollaborators.namespace, ns), eq(repoCollaborators.role, roleId)))
    .limit(1)
  if (u.length) return true
  const g = await db
    .select()
    .from(repoGroupCollaborators)
    .where(and(eq(repoGroupCollaborators.namespace, ns), eq(repoGroupCollaborators.role, roleId)))
    .limit(1)
  return g.length > 0
}

export async function hasCollaboratorGrantIn(
  ns: string,
  user: { key: string; groups: string[] },
): Promise<boolean> {
  const db = getDb()
  const u = await db
    .select()
    .from(repoCollaborators)
    .where(and(eq(repoCollaborators.namespace, ns), eq(repoCollaborators.userKey, user.key)))
    .limit(1)
  if (u.length) return true
  if (!user.groups.length) return false
  const g = await db
    .select()
    .from(repoGroupCollaborators)
    .where(and(eq(repoGroupCollaborators.namespace, ns), inArray(repoGroupCollaborators.groupKey, user.groups)))
    .limit(1)
  return g.length > 0
}

export async function collaboratorNamespaces(user: { key: string; groups: string[] }): Promise<string[]> {
  const db = getDb()
  const u = await db
    .selectDistinct({ namespace: repoCollaborators.namespace })
    .from(repoCollaborators)
    .where(eq(repoCollaborators.userKey, user.key))
  const g = user.groups.length
    ? await db
        .selectDistinct({ namespace: repoGroupCollaborators.namespace })
        .from(repoGroupCollaborators)
        .where(inArray(repoGroupCollaborators.groupKey, user.groups))
    : []
  return [...new Set([...u, ...g].map((r) => r.namespace))]
}

export async function hasAnyCollaboratorGrant(user: { key: string; groups: string[] }): Promise<boolean> {
  return (await collaboratorNamespaces(user)).length > 0
}

export async function setCollaborator(ns: string, repo: string, key: string, role: CollaboratorRoleRef): Promise<void> {
  await getDb()
    .insert(repoCollaborators)
    .values({ namespace: ns, repo, userKey: key, role })
    .onConflictDoUpdate({
      target: [repoCollaborators.namespace, repoCollaborators.repo, repoCollaborators.userKey],
      set: { role },
    })
}

export async function removeCollaborator(ns: string, repo: string, key: string): Promise<boolean> {
  const rows = await getDb()
    .delete(repoCollaborators)
    .where(and(eq(repoCollaborators.namespace, ns), eq(repoCollaborators.repo, repo), eq(repoCollaborators.userKey, key)))
    .returning({ k: repoCollaborators.userKey })
  return rows.length > 0
}

export async function setGroupCollaborator(ns: string, repo: string, group: string, role: CollaboratorRoleRef): Promise<void> {
  await getDb()
    .insert(repoGroupCollaborators)
    .values({ namespace: ns, repo, groupKey: group, role })
    .onConflictDoUpdate({
      target: [repoGroupCollaborators.namespace, repoGroupCollaborators.repo, repoGroupCollaborators.groupKey],
      set: { role },
    })
}

export async function removeGroupCollaborator(ns: string, repo: string, group: string): Promise<boolean> {
  const rows = await getDb()
    .delete(repoGroupCollaborators)
    .where(
      and(
        eq(repoGroupCollaborators.namespace, ns),
        eq(repoGroupCollaborators.repo, repo),
        eq(repoGroupCollaborators.groupKey, group),
      ),
    )
    .returning({ k: repoGroupCollaborators.groupKey })
  return rows.length > 0
}

