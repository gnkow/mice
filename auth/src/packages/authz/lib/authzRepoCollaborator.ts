import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from '../../../db/database.js'
import {
  namespaces,
  repoCollaborators,
  repoCollaboratorVersions,
  repoGroupCollaborators,
  repositories,
} from '../../../db/schema.js'
import type { CollaboratorRoleRef } from './authzTypes.js'
import { appendVersionInterval } from '../../platform/index.js'
import { namespaceIdByName } from './authzRepoNamespaceCore.js'
import { ensureRepository, readRepository } from './authzRepoRepository.js'

export type CollaboratorSeat = { kind: 'user' | 'group'; key: string; role: string }

export type RepoCollaboratorVersion = {
  validFrom: string
  validTo: string | null
  collaborators: CollaboratorSeat[]
}

async function existingRepositoryId(ns: string, repo: string): Promise<string | null> {
  return (await readRepository(ns, repo))?.id ?? null
}

async function requireRepositoryId(ns: string, repo: string): Promise<string | null> {
  return (await ensureRepository(ns, repo))?.id ?? null
}

async function snapshotCollaboratorSeats(tx: Tx, repositoryId: string): Promise<CollaboratorSeat[]> {
  const users = await tx.select().from(repoCollaborators).where(eq(repoCollaborators.repositoryId, repositoryId))
  const groups = await tx
    .select()
    .from(repoGroupCollaborators)
    .where(eq(repoGroupCollaborators.repositoryId, repositoryId))
  const seats: CollaboratorSeat[] = [
    ...users.map((r) => ({ kind: 'user' as const, key: r.userKey, role: r.role })),
    ...groups.map((r) => ({ kind: 'group' as const, key: r.groupKey, role: r.role })),
  ]
  return seats.sort((a, b) =>
    a.kind !== b.kind ? a.kind.localeCompare(b.kind) : a.key.localeCompare(b.key),
  )
}

async function recordCollaboratorVersion(tx: Tx, repositoryId: string, at = new Date()): Promise<void> {
  await appendVersionInterval({
    at,
    closeOpen: async (when) => {
      await tx
        .update(repoCollaboratorVersions)
        .set({ validTo: when })
        .where(
          and(eq(repoCollaboratorVersions.repositoryId, repositoryId), isNull(repoCollaboratorVersions.validTo)),
        )
    },
    openNext: async (when) => {
      await tx.insert(repoCollaboratorVersions).values({
        repositoryId,
        collaborators: await snapshotCollaboratorSeats(tx, repositoryId),
        validFrom: when,
        validTo: null,
        createdAt: when,
      })
    },
  })
}

export async function listRepoCollaboratorVersions(
  ns: string,
  repo: string,
): Promise<RepoCollaboratorVersion[] | null> {
  const repositoryId = await existingRepositoryId(ns, repo)
  if (!repositoryId) return null
  const rows = await getDb()
    .select()
    .from(repoCollaboratorVersions)
    .where(eq(repoCollaboratorVersions.repositoryId, repositoryId))
    .orderBy(asc(repoCollaboratorVersions.validFrom))
  return rows.map((r) => ({
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
    collaborators: r.collaborators,
  }))
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
  await inTransaction(async (tx) => {
    const prev = (
      await tx
        .select()
        .from(repoCollaborators)
        .where(and(eq(repoCollaborators.repositoryId, repositoryId), eq(repoCollaborators.userKey, key)))
    )[0]?.role
    if (prev === role) return
    await tx
      .insert(repoCollaborators)
      .values({ repositoryId, userKey: key, role })
      .onConflictDoUpdate({
        target: [repoCollaborators.repositoryId, repoCollaborators.userKey],
        set: { role },
      })
    await recordCollaboratorVersion(tx, repositoryId)
  })
}

export async function removeCollaborator(ns: string, repo: string, key: string): Promise<boolean> {
  const repositoryId = await existingRepositoryId(ns, repo)
  if (!repositoryId) return false
  return inTransaction(async (tx) => {
    const rows = await tx
      .delete(repoCollaborators)
      .where(and(eq(repoCollaborators.repositoryId, repositoryId), eq(repoCollaborators.userKey, key)))
      .returning({ k: repoCollaborators.userKey })
    if (!rows.length) return false
    await recordCollaboratorVersion(tx, repositoryId)
    return true
  })
}

export async function setGroupCollaborator(ns: string, repo: string, group: string, role: CollaboratorRoleRef): Promise<void> {
  const repositoryId = await requireRepositoryId(ns, repo)
  if (!repositoryId) throw new Error('Repository not found')
  await inTransaction(async (tx) => {
    const prev = (
      await tx
        .select()
        .from(repoGroupCollaborators)
        .where(
          and(eq(repoGroupCollaborators.repositoryId, repositoryId), eq(repoGroupCollaborators.groupKey, group)),
        )
    )[0]?.role
    if (prev === role) return
    await tx
      .insert(repoGroupCollaborators)
      .values({ repositoryId, groupKey: group, role })
      .onConflictDoUpdate({
        target: [repoGroupCollaborators.repositoryId, repoGroupCollaborators.groupKey],
        set: { role },
      })
    await recordCollaboratorVersion(tx, repositoryId)
  })
}

export async function removeGroupCollaborator(ns: string, repo: string, group: string): Promise<boolean> {
  const repositoryId = await existingRepositoryId(ns, repo)
  if (!repositoryId) return false
  return inTransaction(async (tx) => {
    const rows = await tx
      .delete(repoGroupCollaborators)
      .where(
        and(eq(repoGroupCollaborators.repositoryId, repositoryId), eq(repoGroupCollaborators.groupKey, group)),
      )
      .returning({ k: repoGroupCollaborators.groupKey })
    if (!rows.length) return false
    await recordCollaboratorVersion(tx, repositoryId)
    return true
  })
}
