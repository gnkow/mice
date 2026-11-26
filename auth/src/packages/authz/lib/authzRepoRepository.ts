import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from '../../../db/database.js'
import {
  namespaces,
  repositories,
  repositorySettingsVersions,
  repositoryTombstones,
} from '../../../db/schema.js'
import { appendVersionInterval } from '../../platform/index.js'
import { namespaceIdByName } from './authzRepoNamespaceCore.js'
import { isUniqueViolation, type AuthzRepoResult } from './authzRepoShared.js'
import { isNameReservedByTombstone } from './authzRepoTombstone.js'

type Result = AuthzRepoResult

export type RepositoryRecord = {
  id: string
  namespaceId: string
  namespace: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export type RepositorySettingsVersion = {
  validFrom: string
  validTo: string | null
  name: string
  description: string
}

async function openRepositorySettingsVersion(
  tx: Tx,
  repositoryId: string,
  name: string,
  at: Date,
  description = '',
): Promise<void> {
  await tx.insert(repositorySettingsVersions).values({
    repositoryId,
    name,
    description,
    validFrom: at,
    validTo: null,
    createdAt: at,
  })
}

async function closeOpenRepositorySettingsVersion(
  tx: Tx,
  repositoryId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(repositorySettingsVersions)
    .set({ validTo: at })
    .where(
      and(
        eq(repositorySettingsVersions.repositoryId, repositoryId),
        isNull(repositorySettingsVersions.validTo),
      ),
    )
}

/** Close the open settings version and open the next snapshot. */
async function recordRepositorySettingsVersion(
  tx: Tx,
  repositoryId: string,
  name: string,
  description: string,
  at = new Date(),
): Promise<void> {
  await appendVersionInterval({
    at,
    closeOpen: (when) => closeOpenRepositorySettingsVersion(tx, repositoryId, when),
    openNext: (when) => openRepositorySettingsVersion(tx, repositoryId, name, when, description),
  })
}

/** Chronological settings versions for a repository (by current ns/name → stable id). */
export async function listRepositorySettingsVersions(
  ns: string,
  name: string,
): Promise<RepositorySettingsVersion[] | null> {
  const repo = await readRepository(ns, name)
  if (!repo) return null
  const rows = await getDb()
    .select()
    .from(repositorySettingsVersions)
    .where(eq(repositorySettingsVersions.repositoryId, repo.id))
    .orderBy(asc(repositorySettingsVersions.validFrom))
  if (rows.length === 0) {
    // Pre-versioning rows: surface the live settings as the open interval.
    return [
      {
        validFrom: repo.createdAt,
        validTo: null,
        name: repo.name,
        description: repo.description,
      },
    ]
  }
  return rows.map((r) => ({
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
    name: r.name,
    description: r.description,
  }))
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
    description: r.description ?? '',
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
  return isNameReservedByTombstone(row.deletedAt, now)
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
      .values({
        id: randomUUID(),
        namespaceId: nsId,
        name,
        description: '',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning()
    if (inserted[0]) return toRepository(inserted[0], ns)
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
  }
  return readRepository(ns, name)
}

/**
 * Mint a stable repository AuthZ row (idempotent on name).
 * Does **not** add a collaborator seat — repository data access is only via
 * explicit collaborators; namespace Owners manage that list without a seat.
 * `createdByKey` is reserved for attribution; collaborator grants stay opt-in.
 */
export async function createOwnedRepository(
  ns: string,
  name: string,
  _createdByKey: string,
): Promise<RepositoryRecord | null> {
  const nsId = await namespaceIdByName(ns)
  if (!nsId) return null
  if (await repoNameBlocked(nsId, name)) return null
  return inTransaction(async (tx) => {
    const now = new Date()
    const inserted = await tx
      .insert(repositories)
      .values({
        id: randomUUID(),
        namespaceId: nsId,
        name,
        description: '',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning()
    let row = inserted[0]
    if (!row) {
      const existing = await tx
        .select()
        .from(repositories)
        .where(and(eq(repositories.namespaceId, nsId), eq(repositories.name, name)))
        .limit(1)
      row = existing[0]
      if (!row) return null
    }
    if (inserted[0]) {
      await openRepositorySettingsVersion(tx, row.id, name, now, '')
    }
    return toRepository(row, ns)
  })
}

export async function renameRepository(ns: string, from: string, to: string): Promise<Result> {
  const next = to.trim()
  if (!next) return { ok: false, error: 'Repository name required' }
  if (!/^[a-zA-Z0-9._-]+$/.test(next)) return { ok: false, error: 'Invalid repository name' }
  // Same-name is a no-op: do not tombstone the live name (mirrors namespace settings).
  if (next === from) return { ok: true }
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
      const at = new Date()
      await tx
        .insert(repositoryTombstones)
        .values({ namespaceId: nsId, name: from, deletedAt: at })
        .onConflictDoUpdate({
          target: [repositoryTombstones.namespaceId, repositoryTombstones.name],
          set: { deletedAt: at },
        })
      await tx
        .update(repositories)
        .set({ name: next, updatedAt: at })
        .where(eq(repositories.id, repo.id))
      // Backfill an open interval for the previous name when this repo predates versioning.
      const open = await tx
        .select()
        .from(repositorySettingsVersions)
        .where(
          and(
            eq(repositorySettingsVersions.repositoryId, repo.id),
            isNull(repositorySettingsVersions.validTo),
          ),
        )
        .limit(1)
      const description = open[0]?.description ?? repo.description ?? ''
      if (!open[0]) {
        await openRepositorySettingsVersion(tx, repo.id, from, repo.createdAt, description)
      }
      await recordRepositorySettingsVersion(tx, repo.id, next, description, at)
      return { ok: true } as const
    } catch (e) {
      if (isUniqueViolation(e)) return { ok: false, error: 'Repository already exists' } as const
      throw e
    }
  })
}

/** Update the About description (versioned). Name is unchanged. */
export async function updateRepositoryDescription(
  ns: string,
  name: string,
  description: string,
): Promise<Result> {
  const next = description.trim()
  return inTransaction(async (tx) => {
    const rows = await tx
      .select({ repo: repositories })
      .from(repositories)
      .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
      .where(and(eq(namespaces.name, ns), eq(repositories.name, name)))
      .for('update')
    if (!rows[0]) return { ok: false, error: 'Repository not found' } as const
    const { repo } = rows[0]
    if ((repo.description ?? '') === next) return { ok: true } as const
    const at = new Date()
    await tx
      .update(repositories)
      .set({ description: next, updatedAt: at })
      .where(eq(repositories.id, repo.id))
    const open = await tx
      .select()
      .from(repositorySettingsVersions)
      .where(
        and(
          eq(repositorySettingsVersions.repositoryId, repo.id),
          isNull(repositorySettingsVersions.validTo),
        ),
      )
      .limit(1)
    if (!open[0]) {
      await openRepositorySettingsVersion(
        tx,
        repo.id,
        repo.name,
        repo.createdAt,
        repo.description ?? '',
      )
    }
    await recordRepositorySettingsVersion(tx, repo.id, repo.name, next, at)
    return { ok: true } as const
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
