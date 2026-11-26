import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from '../../../db/database.js'
import {
  namespaceMembers,
  namespaces,
  namespaceSettingsVersions,
  namespaceTombstones,
} from '../../../db/schema.js'
import type { BasePermission } from './authzTypes.js'
import { appendVersionInterval } from '../../platform/index.js'
import { openMembershipVersion } from './authzRepoMembership.js'
import {
  type CreateNamespaceResult,
  type NamespaceSettingsPatch,
  type NamespaceSettingsVersion,
  readNamespace,
} from './authzRepoNamespaceCore.js'
import { isUniqueViolation, type AuthzRepoResult } from './authzRepoShared.js'
import { isNameReservedByTombstone } from './authzRepoTombstone.js'

export type {
  CreateNamespaceResult,
  NamespaceSettings,
  NamespaceSettingsPatch,
  NamespaceSettingsVersion,
} from './authzRepoNamespaceCore.js'
export {
  namespaceIdByName,
  namespaceNameById,
  readNamespace,
  readNamespaceById,
  readNamespaces,
} from './authzRepoNamespaceCore.js'

type Result = AuthzRepoResult

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

/** Close the open settings version and open the next from the live namespace row. */
async function recordNamespaceSettingsVersion(
  tx: Tx,
  row: typeof namespaces.$inferSelect,
  at = new Date(),
): Promise<void> {
  await appendVersionInterval({
    at,
    closeOpen: (when) => closeOpenNamespaceSettingsVersion(tx, row.id, when),
    openNext: (when) => openNamespaceSettingsVersion(tx, row, when),
  })
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

async function nameBlockedByTombstone(name: string, now = Date.now()): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(namespaceTombstones)
    .where(eq(namespaceTombstones.name, name))
    .limit(1)
  const row = rows[0]
  if (!row) return false
  return isNameReservedByTombstone(row.deletedAt, now)
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
): Promise<CreateNamespaceResult> {
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
    return { ok: true, id: row.id } as const
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
      await recordNamespaceSettingsVersion(tx, next, at)
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
