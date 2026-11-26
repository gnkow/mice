import { and, asc, eq, isNull } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from '../../../db/database.js'
import {
  namespaceApprovers,
  namespaceApproverVersions,
  repoApprovers,
  repoApproverVersions,
} from '../../../db/schema.js'
import { appendVersionInterval } from '../../platform/index.js'
import { namespaceIdByName } from './authzRepoNamespaceCore.js'
import { ensureRepository, readRepository } from './authzRepoRepository.js'

export type ApproverScope = { ns: string; repo?: string }

export type ApproverVersion = {
  validFrom: string
  validTo: string | null
  /** Seat keys in this interval: user `iss\u001fsub` or group `iss|group_id`. */
  approvers: string[]
}

async function existingRepositoryId(ns: string, repo: string): Promise<string | null> {
  return (await readRepository(ns, repo))?.id ?? null
}

async function requireRepositoryId(ns: string, repo: string): Promise<string | null> {
  return (await ensureRepository(ns, repo))?.id ?? null
}

async function approverScopeId(scope: ApproverScope, create: boolean): Promise<string | null> {
  if (!scope.repo) return namespaceIdByName(scope.ns)
  return create ? requireRepositoryId(scope.ns, scope.repo) : existingRepositoryId(scope.ns, scope.repo)
}

async function snapshotApproverKeys(tx: Tx, scope: ApproverScope, id: string): Promise<string[]> {
  const rows = scope.repo
    ? await tx.select({ k: repoApprovers.userKey }).from(repoApprovers).where(eq(repoApprovers.repositoryId, id))
    : await tx.select({ k: namespaceApprovers.userKey }).from(namespaceApprovers).where(eq(namespaceApprovers.namespaceId, id))
  return rows.map((r) => r.k).sort((a, b) => a.localeCompare(b))
}

/** Append a new approver-set version after a live approver mutation (GxP ticket 124). */
async function recordApproverVersion(tx: Tx, scope: ApproverScope, id: string, at = new Date()): Promise<void> {
  await appendVersionInterval({
    at,
    closeOpen: async (when) => {
      if (scope.repo) {
        await tx
          .update(repoApproverVersions)
          .set({ validTo: when })
          .where(and(eq(repoApproverVersions.repositoryId, id), isNull(repoApproverVersions.validTo)))
      } else {
        await tx
          .update(namespaceApproverVersions)
          .set({ validTo: when })
          .where(and(eq(namespaceApproverVersions.namespaceId, id), isNull(namespaceApproverVersions.validTo)))
      }
    },
    openNext: async (when) => {
      const approvers = await snapshotApproverKeys(tx, scope, id)
      if (scope.repo) {
        await tx
          .insert(repoApproverVersions)
          .values({ repositoryId: id, approvers, validFrom: when, validTo: null, createdAt: when })
      } else {
        await tx
          .insert(namespaceApproverVersions)
          .values({ namespaceId: id, approvers, validFrom: when, validTo: null, createdAt: when })
      }
    },
  })
}

export async function addApprover(scope: ApproverScope, key: string): Promise<boolean> {
  const id = await approverScopeId(scope, true)
  if (!id) return false
  await inTransaction(async (tx) => {
    const inserted = scope.repo
      ? await tx
          .insert(repoApprovers)
          .values({ repositoryId: id, userKey: key })
          .onConflictDoNothing()
          .returning({ k: repoApprovers.userKey })
      : await tx
          .insert(namespaceApprovers)
          .values({ namespaceId: id, userKey: key })
          .onConflictDoNothing()
          .returning({ k: namespaceApprovers.userKey })
    if (inserted.length) await recordApproverVersion(tx, scope, id)
  })
  return true
}

export async function removeApprover(scope: ApproverScope, key: string): Promise<boolean> {
  const id = await approverScopeId(scope, false)
  if (!id) return false
  return inTransaction(async (tx) => {
    const rows = scope.repo
      ? await tx
          .delete(repoApprovers)
          .where(and(eq(repoApprovers.repositoryId, id), eq(repoApprovers.userKey, key)))
          .returning({ k: repoApprovers.userKey })
      : await tx
          .delete(namespaceApprovers)
          .where(and(eq(namespaceApprovers.namespaceId, id), eq(namespaceApprovers.userKey, key)))
          .returning({ k: namespaceApprovers.userKey })
    if (!rows.length) return false
    await recordApproverVersion(tx, scope, id)
    return true
  })
}

/**
 * Chronological approver-seat versions (entity history, not audit). `null` when the namespace is
 * unknown; an empty list when the repository has never had an approver mutation.
 */
export async function listApproverVersions(scope: ApproverScope): Promise<ApproverVersion[] | null> {
  if (!(await namespaceIdByName(scope.ns))) return null
  const id = await approverScopeId(scope, false)
  if (!id) return []
  const rows = scope.repo
    ? await getDb()
        .select()
        .from(repoApproverVersions)
        .where(eq(repoApproverVersions.repositoryId, id))
        .orderBy(asc(repoApproverVersions.validFrom), asc(repoApproverVersions.id))
    : await getDb()
        .select()
        .from(namespaceApproverVersions)
        .where(eq(namespaceApproverVersions.namespaceId, id))
        .orderBy(asc(namespaceApproverVersions.validFrom), asc(namespaceApproverVersions.id))
  return rows.map((r) => ({
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
    approvers: r.approvers,
  }))
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
