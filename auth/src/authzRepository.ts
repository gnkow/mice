import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { TransactionRollbackError } from 'drizzle-orm/errors'
import { matchesIdentityEntry, type SessionUser } from './authentication/index.js'
import { env } from './env.js'
import { getDb, inTransaction, type Tx } from './db/database.js'
import {
  instancePermissions,
  instanceTraining,
  namespaceApprovers,
  namespaceGroupMembers,
  namespaceMembers,
  namespaceMembershipVersions,
  namespaces,
  namespaceSettingsVersions,
  namespaceTombstones,
  repoApprovers,
  repoCollaborators,
  repoGroupCollaborators,
  repositories,
  repositoryTombstones,
} from './db/schema.js'
import {
  normalizeGroup,
  type BasePermission,
  type CollaboratorRoleRef,
  type InstancePermission,
  type MemberRoleRef,
} from './authzTypes.js'
import { toGroupBindingKey } from './groupBinding.js'
import { defaultGroupIssuer } from './groupDisplayStore.js'

export type NamespaceSettings = {
  id: string
  name: string
  description: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
  createdAt: string
  createdBy: string
}

export type NamespaceSettingsPatch = Partial<{
  name: string
  description: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
}>

export type NamespaceSettingsVersion = {
  validFrom: string
  validTo: string | null
  name: string
  description: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
}

export type MembershipSeat = { kind: 'user' | 'group'; key: string; role: string }

export type NamespaceMembershipVersion = {
  validFrom: string
  validTo: string | null
  members: MembershipSeat[]
}

type Result = { ok: true } | { ok: false; error: string }

const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000

export function sessionGroups(user: { groups?: string[]; iss?: string }): string[] {
  const iss = user.iss?.trim() ? user.iss : defaultGroupIssuer()
  const out: string[] = []
  const seen = new Set<string>()
  for (const g of user.groups ?? []) {
    if (!g?.trim()) continue
    const { bindingKey } = toGroupBindingKey(iss, g)
    if (seen.has(bindingKey)) continue
    seen.add(bindingKey)
    out.push(bindingKey)
  }
  return out
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

export async function instancePermissionsOf(
  key: string,
  now = Date.now(),
): Promise<InstancePermission[]> {
  const rows = await getDb().select().from(instancePermissions).where(eq(instancePermissions.userKey, key))
  return rows
    .filter((r) => r.expiresAt.getTime() > now)
    .map((r) => r.permission as InstancePermission)
}

export async function replaceInstancePermissions(
  key: string,
  perms: InstancePermission[],
  expiresAt: Date,
): Promise<void> {
  await inTransaction(async (tx) => {
    await tx.delete(instancePermissions).where(eq(instancePermissions.userKey, key))
    if (perms.length) {
      await tx.insert(instancePermissions).values(
        perms.map((permission) => ({ userKey: key, permission, expiresAt })),
      )
    }
  })
}

export async function listInstancePermissionRows(): Promise<
  Array<{ key: string; permissions: InstancePermission[]; expiresAt: number }>
> {
  const rows = await getDb().select().from(instancePermissions)
  const by = new Map<string, { permissions: InstancePermission[]; expiresAt: number }>()
  for (const r of rows) {
    const expiresAt = r.expiresAt.getTime()
    const cur = by.get(r.userKey)
    if (!cur) {
      by.set(r.userKey, { permissions: [r.permission as InstancePermission], expiresAt })
    } else {
      cur.permissions.push(r.permission as InstancePermission)
      if (expiresAt < cur.expiresAt) cur.expiresAt = expiresAt
    }
  }
  return [...by].map(([key, v]) => ({ key, permissions: v.permissions, expiresAt: v.expiresAt }))
}

/** Deletes instance permission rows whose expires_at is at or before `now`. */
export async function deleteExpiredInstancePermissions(
  now = Date.now(),
): Promise<Array<{ key: string; permissions: InstancePermission[]; expiresAt: number }>> {
  const cutoff = new Date(now)
  const expired = await getDb()
    .select()
    .from(instancePermissions)
    .where(sql`${instancePermissions.expiresAt} <= ${cutoff}`)
  if (expired.length === 0) return []
  const by = new Map<string, { permissions: InstancePermission[]; expiresAt: number }>()
  for (const r of expired) {
    const expiresAt = r.expiresAt.getTime()
    const cur = by.get(r.userKey)
    if (!cur) {
      by.set(r.userKey, { permissions: [r.permission as InstancePermission], expiresAt })
    } else {
      cur.permissions.push(r.permission as InstancePermission)
      if (expiresAt < cur.expiresAt) cur.expiresAt = expiresAt
    }
  }
  await getDb().delete(instancePermissions).where(sql`${instancePermissions.expiresAt} <= ${cutoff}`)
  return [...by].map(([key, v]) => ({ key, permissions: v.permissions, expiresAt: v.expiresAt }))
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
    id: r.id,
    name: r.name,
    description: r.description,
    basePermission: r.basePermission as BasePermission,
    membersCanCreateRepos: r.membersCanCreateRepos,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
  }
}

async function openNamespaceSettingsVersion(
  tx: Tx,
  row: typeof namespaces.$inferSelect,
  at: Date,
): Promise<void> {
  await tx.insert(namespaceSettingsVersions).values({
    namespaceId: row.id,
    name: row.name,
    description: row.description,
    basePermission: row.basePermission,
    membersCanCreateRepos: row.membersCanCreateRepos,
    validFrom: at,
    validTo: null,
    createdAt: at,
  })
}

async function closeOpenNamespaceSettingsVersion(tx: Tx, namespaceId: string, at: Date): Promise<void> {
  await tx
    .update(namespaceSettingsVersions)
    .set({ validTo: at })
    .where(
      and(eq(namespaceSettingsVersions.namespaceId, namespaceId), isNull(namespaceSettingsVersions.validTo)),
    )
}

/** Chronological settings versions for a namespace (by current name → stable id). */
export async function listNamespaceSettingsVersions(ns: string): Promise<NamespaceSettingsVersion[] | null> {
  const settings = await readNamespace(ns)
  if (!settings) return null
  const rows = await getDb()
    .select()
    .from(namespaceSettingsVersions)
    .where(eq(namespaceSettingsVersions.namespaceId, settings.id))
    .orderBy(asc(namespaceSettingsVersions.validFrom))
  return rows.map((r) => ({
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
    name: r.name,
    description: r.description,
    basePermission: r.basePermission as BasePermission,
    membersCanCreateRepos: r.membersCanCreateRepos,
  }))
}

async function snapshotMembershipSeats(tx: Tx, namespaceId: string): Promise<MembershipSeat[]> {
  const users = await tx.select().from(namespaceMembers).where(eq(namespaceMembers.namespaceId, namespaceId))
  const groups = await tx
    .select()
    .from(namespaceGroupMembers)
    .where(eq(namespaceGroupMembers.namespaceId, namespaceId))
  const seats: MembershipSeat[] = [
    ...users.map((r) => ({ kind: 'user' as const, key: r.userKey, role: r.role })),
    ...groups.map((r) => ({ kind: 'group' as const, key: r.groupKey, role: r.role })),
  ]
  return seats.sort((a, b) =>
    a.kind !== b.kind ? a.kind.localeCompare(b.kind) : a.key.localeCompare(b.key),
  )
}

async function closeOpenMembershipVersion(tx: Tx, namespaceId: string, at: Date): Promise<void> {
  await tx
    .update(namespaceMembershipVersions)
    .set({ validTo: at })
    .where(
      and(eq(namespaceMembershipVersions.namespaceId, namespaceId), isNull(namespaceMembershipVersions.validTo)),
    )
}

async function openMembershipVersion(tx: Tx, namespaceId: string, at: Date): Promise<void> {
  const members = await snapshotMembershipSeats(tx, namespaceId)
  await tx.insert(namespaceMembershipVersions).values({
    namespaceId,
    members,
    validFrom: at,
    validTo: null,
    createdAt: at,
  })
}

/** Append a new membership-set version after a live membership mutation. */
async function recordMembershipVersion(tx: Tx, namespaceId: string, at = new Date()): Promise<void> {
  await closeOpenMembershipVersion(tx, namespaceId, at)
  await openMembershipVersion(tx, namespaceId, at)
}

/** Chronological membership-set versions for a namespace (entity history, not audit). */
export async function listNamespaceMembershipVersions(
  ns: string,
): Promise<NamespaceMembershipVersion[] | null> {
  const settings = await readNamespace(ns)
  if (!settings) return null
  const rows = await getDb()
    .select()
    .from(namespaceMembershipVersions)
    .where(eq(namespaceMembershipVersions.namespaceId, settings.id))
    .orderBy(asc(namespaceMembershipVersions.validFrom))
  return rows.map((r) => ({
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
    members: r.members,
  }))
}

export async function namespaceIdByName(name: string, tx: Tx | ReturnType<typeof getDb> = getDb()): Promise<string | null> {
  const rows = await tx.select({ id: namespaces.id }).from(namespaces).where(eq(namespaces.name, name)).limit(1)
  return rows[0]?.id ?? null
}

export async function namespaceNameById(id: string, tx: Tx | ReturnType<typeof getDb> = getDb()): Promise<string | null> {
  const rows = await tx.select({ name: namespaces.name }).from(namespaces).where(eq(namespaces.id, id)).limit(1)
  return rows[0]?.name ?? null
}

async function nameBlockedByTombstone(name: string, now = Date.now()): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(namespaceTombstones)
    .where(eq(namespaceTombstones.name, name))
    .limit(1)
  const row = rows[0]
  if (!row) return false
  return now - row.deletedAt.getTime() < TOMBSTONE_MS
}

export async function readNamespace(name: string): Promise<NamespaceSettings | null> {
  const rows = await getDb().select().from(namespaces).where(eq(namespaces.name, name)).limit(1)
  return rows[0] ? toSettings(rows[0]) : null
}

export async function readNamespaceById(id: string): Promise<NamespaceSettings | null> {
  const rows = await getDb().select().from(namespaces).where(eq(namespaces.id, id)).limit(1)
  return rows[0] ? toSettings(rows[0]) : null
}

export async function readNamespaces(): Promise<Record<string, NamespaceSettings>> {
  const rows = await getDb().select().from(namespaces)
  return Object.fromEntries(rows.map((r) => [r.name, toSettings(r)]))
}

/**
 * Mint a stable namespace id, insert settings, make `ownerKey` Owner, open the first settings version.
 * Shared by create and ensure so rename-by-id always has one mint path.
 */
async function insertOwnedNamespace(
  tx: Tx,
  input: {
    ownerKey: string
    name: string
    description: string
    basePermission: BasePermission
    membersCanCreateRepos: boolean
    at?: Date
  },
): Promise<typeof namespaces.$inferSelect | null> {
  const at = input.at ?? new Date()
  const inserted = await tx
    .insert(namespaces)
    .values({
      id: randomUUID(),
      name: input.name,
      description: input.description,
      basePermission: input.basePermission,
      membersCanCreateRepos: input.membersCanCreateRepos,
      createdAt: at,
      createdBy: input.ownerKey,
    })
    .onConflictDoNothing()
    .returning()
  const row = inserted[0]
  if (!row) return null
  await tx
    .insert(namespaceMembers)
    .values({ namespaceId: row.id, userKey: input.ownerKey, role: 'owner' })
    .onConflictDoNothing()
  await openNamespaceSettingsVersion(tx, row, at)
  await openMembershipVersion(tx, row.id, at)
  return row
}

export async function createNamespace(
  creator: string,
  name: string,
  basePermission: BasePermission,
  membersCanCreateRepos: boolean,
  description = '',
): Promise<Result> {
  if (await nameBlockedByTombstone(name)) {
    return { ok: false, error: 'Namespace name is reserved after deletion' }
  }
  return inTransaction(async (tx) => {
    const row = await insertOwnedNamespace(tx, {
      ownerKey: creator,
      name,
      description,
      basePermission,
      membersCanCreateRepos,
    })
    if (!row) return { ok: false, error: 'Namespace already exists' } as const
    return { ok: true } as const
  })
}

/** Seed the namespace if missing and make `actor` its owner when seeding. */
export async function ensureNamespace(actor: string, name: string, basePermission: BasePermission): Promise<void> {
  if (await nameBlockedByTombstone(name)) return
  await inTransaction(async (tx) => {
    await insertOwnedNamespace(tx, {
      ownerKey: actor,
      name,
      description: '',
      basePermission,
      membersCanCreateRepos: true,
    })
  })
}

/**
 * Updates live namespace settings and appends an entity version.
 * Name changes are settings PATCH (no separate rename API).
 */
export async function updateNamespaceSettings(
  currentName: string,
  patch: NamespaceSettingsPatch,
): Promise<Result> {
  const nextName = patch.name !== undefined ? patch.name.trim() : undefined
  if (nextName !== undefined) {
    if (!nextName) return { ok: false, error: 'Namespace name required' }
    if (!/^[a-zA-Z0-9._-]+$/.test(nextName)) return { ok: false, error: 'Invalid namespace name' }
    if (nextName !== currentName && (await nameBlockedByTombstone(nextName))) {
      return { ok: false, error: 'Namespace name is reserved after deletion' }
    }
  }

  return inTransaction(async (tx) => {
    const rows = await tx.select().from(namespaces).where(eq(namespaces.name, currentName)).for('update')
    const row = rows[0]
    if (!row) return { ok: false, error: 'Namespace not found' } as const

    const set: Partial<typeof namespaces.$inferInsert> = {}
    if (nextName !== undefined && nextName !== row.name) set.name = nextName
    if (patch.description !== undefined) set.description = patch.description
    if (patch.basePermission !== undefined) set.basePermission = patch.basePermission
    if (patch.membersCanCreateRepos !== undefined) set.membersCanCreateRepos = patch.membersCanCreateRepos
    if (Object.keys(set).length === 0) return { ok: true } as const

    const at = new Date()
    try {
      if (set.name && set.name !== currentName) {
        await tx.insert(namespaceTombstones).values({ name: currentName, deletedAt: at }).onConflictDoUpdate({
          target: namespaceTombstones.name,
          set: { deletedAt: at },
        })
      }
      const updated = await tx
        .update(namespaces)
        .set(set)
        .where(eq(namespaces.id, row.id))
        .returning()
      const next = updated[0]
      if (!next) return { ok: false, error: 'Namespace not found' } as const
      await closeOpenNamespaceSettingsVersion(tx, row.id, at)
      await openNamespaceSettingsVersion(tx, next, at)
      return { ok: true } as const
    } catch (e) {
      if (isUniqueViolation(e)) return { ok: false, error: 'Namespace already exists' } as const
      throw e
    }
  })
}

/** Removes a namespace; members, collaborators and custom roles go with it through foreign keys. */
export async function deleteNamespace(name: string): Promise<Result> {
  return inTransaction(async (tx) => {
    const deleted = await tx
      .delete(namespaces)
      .where(eq(namespaces.name, name))
      .returning({ name: namespaces.name })
    if (!deleted.length) return { ok: false, error: 'Namespace not found' } as const
    await tx.insert(namespaceTombstones).values({ name, deletedAt: new Date() }).onConflictDoUpdate({
      target: namespaceTombstones.name,
      set: { deletedAt: new Date() },
    })
    return { ok: true } as const
  })
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })
  return code?.code === '23505' || code?.cause?.code === '23505'
}

// ── Repositories ────────────────────────────────────────────────────────────

export type RepositoryRecord = {
  id: string
  namespaceId: string
  namespace: string
  name: string
  createdAt: string
  updatedAt: string
}

function toRepository(
  r: typeof repositories.$inferSelect,
  namespace: string,
): RepositoryRecord {
  return {
    id: r.id,
    namespaceId: r.namespaceId,
    namespace,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

async function repoNameBlocked(namespaceId: string, name: string, now = Date.now()): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(repositoryTombstones)
    .where(and(eq(repositoryTombstones.namespaceId, namespaceId), eq(repositoryTombstones.name, name)))
    .limit(1)
  const row = rows[0]
  if (!row) return false
  return now - row.deletedAt.getTime() < TOMBSTONE_MS
}

export async function readRepository(ns: string, name: string): Promise<RepositoryRecord | null> {
  const rows = await getDb()
    .select({ repo: repositories, nsName: namespaces.name })
    .from(repositories)
    .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
    .where(and(eq(namespaces.name, ns), eq(repositories.name, name)))
    .limit(1)
  return rows[0] ? toRepository(rows[0].repo, rows[0].nsName) : null
}

export async function readRepositoryById(id: string): Promise<RepositoryRecord | null> {
  const rows = await getDb()
    .select({ repo: repositories, nsName: namespaces.name })
    .from(repositories)
    .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
    .where(eq(repositories.id, id))
    .limit(1)
  return rows[0] ? toRepository(rows[0].repo, rows[0].nsName) : null
}

/** Mint or return the repository row for a namespace/name path. */
export async function ensureRepository(ns: string, name: string): Promise<RepositoryRecord | null> {
  const existing = await readRepository(ns, name)
  if (existing) return existing
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return null
  if (await repoNameBlocked(nsId, name)) return null
  const now = new Date()
  try {
    const inserted = await getDb()
      .insert(repositories)
      .values({ namespaceId: nsId, name, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning()
    if (inserted[0]) return toRepository(inserted[0], ns)
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
  }
  return readRepository(ns, name)
}

export async function renameRepository(ns: string, from: string, to: string): Promise<Result> {
  const next = to.trim()
  if (!next) return { ok: false, error: 'Repository name required' }
  if (!/^[a-zA-Z0-9._-]+$/.test(next)) return { ok: false, error: 'Invalid repository name' }
  return inTransaction(async (tx) => {
    const rows = await tx
      .select({ repo: repositories, nsId: namespaces.id })
      .from(repositories)
      .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
      .where(and(eq(namespaces.name, ns), eq(repositories.name, from)))
      .for('update')
    if (!rows[0]) return { ok: false, error: 'Repository not found' } as const
    const { repo, nsId } = rows[0]
    if (await repoNameBlocked(nsId, next)) {
      return { ok: false, error: 'Repository name is reserved after deletion' } as const
    }
    try {
      await tx
        .insert(repositoryTombstones)
        .values({ namespaceId: nsId, name: from, deletedAt: new Date() })
        .onConflictDoUpdate({
          target: [repositoryTombstones.namespaceId, repositoryTombstones.name],
          set: { deletedAt: new Date() },
        })
      await tx
        .update(repositories)
        .set({ name: next, updatedAt: new Date() })
        .where(eq(repositories.id, repo.id))
      return { ok: true } as const
    } catch (e) {
      if (isUniqueViolation(e)) return { ok: false, error: 'Repository already exists' } as const
      throw e
    }
  })
}

export async function deleteRepositoryRecord(ns: string, name: string): Promise<Result> {
  return inTransaction(async (tx) => {
    const rows = await tx
      .select({ repo: repositories, nsId: namespaces.id })
      .from(repositories)
      .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
      .where(and(eq(namespaces.name, ns), eq(repositories.name, name)))
    if (!rows[0]) return { ok: false, error: 'Repository not found' } as const
    await tx.delete(repositories).where(eq(repositories.id, rows[0].repo.id))
    await tx
      .insert(repositoryTombstones)
      .values({ namespaceId: rows[0].nsId, name, deletedAt: new Date() })
      .onConflictDoUpdate({
        target: [repositoryTombstones.namespaceId, repositoryTombstones.name],
        set: { deletedAt: new Date() },
      })
    return { ok: true } as const
  })
}

// ── Members ─────────────────────────────────────────────────────────────────

async function lockNamespace(tx: Tx, ns: string): Promise<typeof namespaces.$inferSelect | null> {
  const rows = await tx.select().from(namespaces).where(eq(namespaces.name, ns)).for('update')
  return rows[0] ?? null
}

async function ownerCount(tx: Tx, namespaceId: string): Promise<number> {
  const users = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespaceId, namespaceId), eq(namespaceMembers.role, 'owner')))
  const groups = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(namespaceGroupMembers)
    .where(and(eq(namespaceGroupMembers.namespaceId, namespaceId), eq(namespaceGroupMembers.role, 'owner')))
  return (users[0]?.n ?? 0) + (groups[0]?.n ?? 0)
}

export async function membershipRefs(
  user: { key: string; groups: string[] },
  ns?: string,
): Promise<Array<{ namespace: string; role: MemberRoleRef }>> {
  const db = getDb()
  const nsId = ns ? await namespaceIdByName(ns) : null
  if (ns && !nsId) return []
  const direct = await db
    .select({ namespace: namespaces.name, role: namespaceMembers.role })
    .from(namespaceMembers)
    .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
    .where(and(eq(namespaceMembers.userKey, user.key), nsId ? eq(namespaceMembers.namespaceId, nsId) : undefined))
  const viaGroups = user.groups.length
    ? await db
        .select({ namespace: namespaces.name, role: namespaceGroupMembers.role })
        .from(namespaceGroupMembers)
        .innerJoin(namespaces, eq(namespaces.id, namespaceGroupMembers.namespaceId))
        .where(
          and(
            inArray(namespaceGroupMembers.groupKey, user.groups),
            nsId ? eq(namespaceGroupMembers.namespaceId, nsId) : undefined,
          ),
        )
    : []
  return [...direct, ...viaGroups]
}

export async function directMemberRole(ns: string, key: string): Promise<MemberRoleRef | null> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return null
  const rows = await getDb()
    .select()
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespaceId, nsId), eq(namespaceMembers.userKey, key)))
    .limit(1)
  return rows[0]?.role ?? null
}

export async function listMemberRows(ns: string): Promise<{
  users: Array<{ key: string; role: MemberRoleRef }>
  groups: Array<{ group: string; role: MemberRoleRef }>
}> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return { users: [], groups: [] }
  const db = getDb()
  const users = await db.select().from(namespaceMembers).where(eq(namespaceMembers.namespaceId, nsId))
  const groups = await db.select().from(namespaceGroupMembers).where(eq(namespaceGroupMembers.namespaceId, nsId))
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
      .select({ namespace: namespaces.name, n: sql<number>`count(*)::int` })
      .from(namespaceMembers)
      .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
      .groupBy(namespaces.name),
  )
  add(
    await db
      .select({ namespace: namespaces.name, n: sql<number>`count(*)::int` })
      .from(namespaceGroupMembers)
      .innerJoin(namespaces, eq(namespaces.id, namespaceGroupMembers.namespaceId))
      .groupBy(namespaces.name),
  )
  return out
}

export async function isMemberRoleAssigned(ns: string, roleId: string): Promise<boolean> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return false
  const db = getDb()
  const u = await db
    .select()
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespaceId, nsId), eq(namespaceMembers.role, roleId)))
    .limit(1)
  if (u.length) return true
  const g = await db
    .select()
    .from(namespaceGroupMembers)
    .where(and(eq(namespaceGroupMembers.namespaceId, nsId), eq(namespaceGroupMembers.role, roleId)))
    .limit(1)
  return g.length > 0
}

export async function ownedNamespaceNames(user: { key: string; groups: string[] }): Promise<string[]> {
  const refs = await membershipRefs(user)
  return [...new Set(refs.filter((r) => r.role === 'owner').map((r) => r.namespace))]
}

export async function setMember(ns: string, key: string, role: MemberRoleRef): Promise<Result> {
  return inTransaction(async (tx) => {
    const locked = await lockNamespace(tx, ns)
    if (!locked) return { ok: false, error: 'Namespace not found' } as const
    const prev = (
      await tx
        .select()
        .from(namespaceMembers)
        .where(and(eq(namespaceMembers.namespaceId, locked.id), eq(namespaceMembers.userKey, key)))
    )[0]?.role
    if (prev === role) return { ok: true } as const
    await tx
      .insert(namespaceMembers)
      .values({ namespaceId: locked.id, userKey: key, role })
      .onConflictDoUpdate({ target: [namespaceMembers.namespaceId, namespaceMembers.userKey], set: { role } })
    if (prev === 'owner' && role !== 'owner' && (await ownerCount(tx, locked.id)) === 0) {
      tx.rollback()
    }
    await recordMembershipVersion(tx, locked.id)
    return { ok: true } as const
  }).catch((e: unknown) => rollbackAs(e, 'Cannot demote the last namespace Owner'))
}

export async function removeMember(ns: string, key: string): Promise<Result> {
  return inTransaction(async (tx) => {
    const locked = await lockNamespace(tx, ns)
    if (!locked) return { ok: false, error: 'Namespace not found' } as const
    const cur = (
      await tx
        .select()
        .from(namespaceMembers)
        .where(and(eq(namespaceMembers.namespaceId, locked.id), eq(namespaceMembers.userKey, key)))
    )[0]
    if (!cur) return { ok: true } as const
    if (cur.role === 'owner' && (await ownerCount(tx, locked.id)) <= 1) {
      return { ok: false, error: 'Cannot remove the last namespace Owner' } as const
    }
    await tx
      .delete(namespaceMembers)
      .where(and(eq(namespaceMembers.namespaceId, locked.id), eq(namespaceMembers.userKey, key)))
    await recordMembershipVersion(tx, locked.id)
    return { ok: true } as const
  })
}

export async function setGroupMember(ns: string, group: string, role: MemberRoleRef): Promise<Result> {
  return inTransaction(async (tx) => {
    const locked = await lockNamespace(tx, ns)
    if (!locked) return { ok: false, error: 'Namespace not found' } as const
    const prev = (
      await tx
        .select()
        .from(namespaceGroupMembers)
        .where(and(eq(namespaceGroupMembers.namespaceId, locked.id), eq(namespaceGroupMembers.groupKey, group)))
    )[0]?.role
    if (prev === role) return { ok: true } as const
    await tx
      .insert(namespaceGroupMembers)
      .values({ namespaceId: locked.id, groupKey: group, role })
      .onConflictDoUpdate({
        target: [namespaceGroupMembers.namespaceId, namespaceGroupMembers.groupKey],
        set: { role },
      })
    if (prev === 'owner' && role !== 'owner' && (await ownerCount(tx, locked.id)) === 0) {
      tx.rollback()
    }
    await recordMembershipVersion(tx, locked.id)
    return { ok: true } as const
  }).catch((e: unknown) => rollbackAs(e, 'Cannot demote the last namespace Owner'))
}

export async function removeGroupMember(ns: string, group: string): Promise<Result> {
  return inTransaction(async (tx) => {
    const locked = await lockNamespace(tx, ns)
    if (!locked) return { ok: false, error: 'Namespace not found' } as const
    const cur = (
      await tx
        .select()
        .from(namespaceGroupMembers)
        .where(and(eq(namespaceGroupMembers.namespaceId, locked.id), eq(namespaceGroupMembers.groupKey, group)))
    )[0]
    if (!cur) return { ok: false, error: 'Group member not found' } as const
    if (cur.role === 'owner' && (await ownerCount(tx, locked.id)) <= 1) {
      return { ok: false, error: 'Cannot remove the last namespace Owner' } as const
    }
    await tx
      .delete(namespaceGroupMembers)
      .where(and(eq(namespaceGroupMembers.namespaceId, locked.id), eq(namespaceGroupMembers.groupKey, group)))
    await recordMembershipVersion(tx, locked.id)
    return { ok: true } as const
  })
}

/** `tx.rollback()` throws a TransactionRollbackError; turn it into the intended refusal. */
function rollbackAs(e: unknown, error: string): Result {
  if (e instanceof TransactionRollbackError) return { ok: false, error }
  throw e
}

// ── Collaborators ───────────────────────────────────────────────────────────

async function existingRepositoryId(ns: string, repo: string): Promise<string | null> {
  return (await readRepository(ns, repo))?.id ?? null
}

async function requireRepositoryId(ns: string, repo: string): Promise<string | null> {
  return (await ensureRepository(ns, repo))?.id ?? null
}

export async function directCollaboratorRole(ns: string, repo: string, key: string): Promise<CollaboratorRoleRef | null> {
  const repositoryId = await existingRepositoryId(ns, repo)
  if (!repositoryId) return null
  const rows = await getDb()
    .select()
    .from(repoCollaborators)
    .where(and(eq(repoCollaborators.repositoryId, repositoryId), eq(repoCollaborators.userKey, key)))
    .limit(1)
  return rows[0]?.role ?? null
}

export async function groupCollaboratorRoles(
  ns: string,
  repo: string,
  groups: string[],
): Promise<Array<{ group: string; role: CollaboratorRoleRef }>> {
  if (!groups.length) return []
  const repositoryId = await existingRepositoryId(ns, repo)
  if (!repositoryId) return []
  const rows = await getDb()
    .select()
    .from(repoGroupCollaborators)
    .where(and(eq(repoGroupCollaborators.repositoryId, repositoryId), inArray(repoGroupCollaborators.groupKey, groups)))
  return rows.map((r) => ({ group: r.groupKey, role: r.role }))
}

export async function listCollaboratorRows(ns: string, repo: string): Promise<{
  users: Array<{ key: string; role: CollaboratorRoleRef }>
  groups: Array<{ group: string; role: CollaboratorRoleRef }>
}> {
  const repositoryId = await existingRepositoryId(ns, repo)
  if (!repositoryId) return { users: [], groups: [] }
  const db = getDb()
  const users = await db.select().from(repoCollaborators).where(eq(repoCollaborators.repositoryId, repositoryId))
  const groups = await db
    .select()
    .from(repoGroupCollaborators)
    .where(eq(repoGroupCollaborators.repositoryId, repositoryId))
  return {
    users: users.map((r) => ({ key: r.userKey, role: r.role })),
    groups: groups.map((r) => ({ group: r.groupKey, role: r.role })),
  }
}

export async function listNamespaceGroupCollaboratorRows(ns: string): Promise<
  Array<{ repo: string; group: string; role: CollaboratorRoleRef }>
> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return []
  const rows = await getDb()
    .select({
      repo: repositories.name,
      group: repoGroupCollaborators.groupKey,
      role: repoGroupCollaborators.role,
    })
    .from(repoGroupCollaborators)
    .innerJoin(repositories, eq(repositories.id, repoGroupCollaborators.repositoryId))
    .where(eq(repositories.namespaceId, nsId))
  return rows.map((row) => ({ repo: row.repo, group: row.group, role: row.role }))
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
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return false
  const db = getDb()
  const u = await db
    .select()
    .from(repoCollaborators)
    .innerJoin(repositories, eq(repositories.id, repoCollaborators.repositoryId))
    .where(and(eq(repositories.namespaceId, nsId), eq(repoCollaborators.role, roleId)))
    .limit(1)
  if (u.length) return true
  const g = await db
    .select()
    .from(repoGroupCollaborators)
    .innerJoin(repositories, eq(repositories.id, repoGroupCollaborators.repositoryId))
    .where(and(eq(repositories.namespaceId, nsId), eq(repoGroupCollaborators.role, roleId)))
    .limit(1)
  return g.length > 0
}

export async function hasCollaboratorGrantIn(
  ns: string,
  user: { key: string; groups: string[] },
): Promise<boolean> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return false
  const db = getDb()
  const u = await db
    .select()
    .from(repoCollaborators)
    .innerJoin(repositories, eq(repositories.id, repoCollaborators.repositoryId))
    .where(and(eq(repositories.namespaceId, nsId), eq(repoCollaborators.userKey, user.key)))
    .limit(1)
  if (u.length) return true
  if (!user.groups.length) return false
  const g = await db
    .select()
    .from(repoGroupCollaborators)
    .innerJoin(repositories, eq(repositories.id, repoGroupCollaborators.repositoryId))
    .where(and(eq(repositories.namespaceId, nsId), inArray(repoGroupCollaborators.groupKey, user.groups)))
    .limit(1)
  return g.length > 0
}

export async function collaboratorNamespaces(user: { key: string; groups: string[] }): Promise<string[]> {
  const db = getDb()
  const u = await db
    .selectDistinct({ namespace: namespaces.name })
    .from(repoCollaborators)
    .innerJoin(repositories, eq(repositories.id, repoCollaborators.repositoryId))
    .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
    .where(eq(repoCollaborators.userKey, user.key))
  const g = user.groups.length
    ? await db
        .selectDistinct({ namespace: namespaces.name })
        .from(repoGroupCollaborators)
        .innerJoin(repositories, eq(repositories.id, repoGroupCollaborators.repositoryId))
        .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
        .where(inArray(repoGroupCollaborators.groupKey, user.groups))
    : []
  return [...new Set([...u, ...g].map((r) => r.namespace))]
}

export async function hasAnyCollaboratorGrant(user: { key: string; groups: string[] }): Promise<boolean> {
  return (await collaboratorNamespaces(user)).length > 0
}

export async function setCollaborator(ns: string, repo: string, key: string, role: CollaboratorRoleRef): Promise<void> {
  const repositoryId = await requireRepositoryId(ns, repo)
  if (!repositoryId) throw new Error('Repository not found')
  await getDb()
    .insert(repoCollaborators)
    .values({ repositoryId, userKey: key, role })
    .onConflictDoUpdate({
      target: [repoCollaborators.repositoryId, repoCollaborators.userKey],
      set: { role },
    })
}

export async function removeCollaborator(ns: string, repo: string, key: string): Promise<boolean> {
  const repositoryId = await existingRepositoryId(ns, repo)
  if (!repositoryId) return false
  const rows = await getDb()
    .delete(repoCollaborators)
    .where(and(eq(repoCollaborators.repositoryId, repositoryId), eq(repoCollaborators.userKey, key)))
    .returning({ k: repoCollaborators.userKey })
  return rows.length > 0
}

export async function setGroupCollaborator(ns: string, repo: string, group: string, role: CollaboratorRoleRef): Promise<void> {
  const repositoryId = await requireRepositoryId(ns, repo)
  if (!repositoryId) throw new Error('Repository not found')
  await getDb()
    .insert(repoGroupCollaborators)
    .values({ repositoryId, groupKey: group, role })
    .onConflictDoUpdate({
      target: [repoGroupCollaborators.repositoryId, repoGroupCollaborators.groupKey],
      set: { role },
    })
}

export async function removeGroupCollaborator(ns: string, repo: string, group: string): Promise<boolean> {
  const repositoryId = await existingRepositoryId(ns, repo)
  if (!repositoryId) return false
  const rows = await getDb()
    .delete(repoGroupCollaborators)
    .where(
      and(eq(repoGroupCollaborators.repositoryId, repositoryId), eq(repoGroupCollaborators.groupKey, group)),
    )
    .returning({ k: repoGroupCollaborators.groupKey })
  return rows.length > 0
}

// ── Approvers ───────────────────────────────────────────────────────────────

export type ApproverScope = { ns: string; repo?: string }

async function approverScopeId(scope: ApproverScope, create: boolean): Promise<string | null> {
  if (!scope.repo) return namespaceIdByName(scope.ns)
  return create ? requireRepositoryId(scope.ns, scope.repo) : existingRepositoryId(scope.ns, scope.repo)
}

export async function addApprover(scope: ApproverScope, key: string): Promise<boolean> {
  const id = await approverScopeId(scope, true)
  if (!id) return false
  if (scope.repo) {
    await getDb().insert(repoApprovers).values({ repositoryId: id, userKey: key }).onConflictDoNothing()
  } else {
    await getDb().insert(namespaceApprovers).values({ namespaceId: id, userKey: key }).onConflictDoNothing()
  }
  return true
}

export async function removeApprover(scope: ApproverScope, key: string): Promise<boolean> {
  const id = await approverScopeId(scope, false)
  if (!id) return false
  const rows = scope.repo
    ? await getDb()
        .delete(repoApprovers)
        .where(and(eq(repoApprovers.repositoryId, id), eq(repoApprovers.userKey, key)))
        .returning({ k: repoApprovers.userKey })
    : await getDb()
        .delete(namespaceApprovers)
        .where(and(eq(namespaceApprovers.namespaceId, id), eq(namespaceApprovers.userKey, key)))
        .returning({ k: namespaceApprovers.userKey })
  return rows.length > 0
}

export async function listApproverKeys(scope: ApproverScope): Promise<string[]> {
  const id = await approverScopeId(scope, false)
  if (!id) return []
  const rows = scope.repo
    ? await getDb().select({ k: repoApprovers.userKey }).from(repoApprovers).where(eq(repoApprovers.repositoryId, id))
    : await getDb().select({ k: namespaceApprovers.userKey }).from(namespaceApprovers).where(eq(namespaceApprovers.namespaceId, id))
  return rows.map((r) => r.k)
}

/** True when the user is an approver on the repository directly or through its namespace. */
export async function isApproverKey(ns: string, repo: string, key: string): Promise<boolean> {
  const nsId = await namespaceIdByName(ns)
  if (nsId) {
    const rows = await getDb()
      .select({ k: namespaceApprovers.userKey })
      .from(namespaceApprovers)
      .where(and(eq(namespaceApprovers.namespaceId, nsId), eq(namespaceApprovers.userKey, key)))
      .limit(1)
    if (rows.length) return true
  }
  const repoId = await existingRepositoryId(ns, repo)
  if (!repoId) return false
  const rows = await getDb()
    .select({ k: repoApprovers.userKey })
    .from(repoApprovers)
    .where(and(eq(repoApprovers.repositoryId, repoId), eq(repoApprovers.userKey, key)))
    .limit(1)
  return rows.length > 0
}
