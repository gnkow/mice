import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { getDb, inTransaction, type Tx } from '../../../db/database.js'
import {
  namespaceGroupMembers,
  namespaceMembers,
  namespaces,
  repoApprovers,
  repoApproverVersions,
  repoCollaborators,
  repoCollaboratorVersions,
  repoGroupCollaborators,
  repositories,
  repositoryTransfers,
} from '../../../db/schema.js'
import { appendVersionInterval } from '../../platform/index.js'
import { isUserApproverStorageKey } from './authzApproverStore.js'
import { namespaceIdByName, readNamespace } from './authzRepoNamespaceCore.js'
import { isUniqueViolation, type AuthzRepoResult } from './authzRepoShared.js'
import { readRepository, type RepositoryRecord } from './authzRepoRepository.js'
import {
  partitionTransferAccess,
  type TransferAccessDiff,
} from './repoTransferAccess.js'
import type { BasePermission } from './authzTypes.js'

type Result = AuthzRepoResult

export const TRANSFER_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type RepositoryTransferStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'expired'

export type RepositoryTransferRecord = {
  id: string
  repositoryId: string
  repositoryName: string
  sourceNamespace: string
  sourceNamespaceId: string
  targetNamespace: string
  targetNamespaceId: string
  proposedBy: string
  status: RepositoryTransferStatus
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  expiresAt: string
}

export type TransferCompleteResult =
  | { ok: true; repository: RepositoryRecord; accessDiff: TransferAccessDiff; mode: 'one-shot' | 'accept' }
  | { ok: false; error: string; code?: string }

export type TransferProposeResult =
  | { ok: true; mode: 'one-shot'; repository: RepositoryRecord; accessDiff: TransferAccessDiff }
  | { ok: true; mode: 'pending'; transfer: RepositoryTransferRecord; accessDiff: TransferAccessDiff }
  | { ok: false; error: string; code?: string }

function toTransfer(
  row: typeof repositoryTransfers.$inferSelect,
  names: {
    repositoryName: string
    sourceNamespace: string
    targetNamespace: string
  },
): RepositoryTransferRecord {
  const createdMs = row.createdAt.getTime()
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    repositoryName: names.repositoryName,
    sourceNamespace: names.sourceNamespace,
    sourceNamespaceId: row.sourceNamespaceId,
    targetNamespace: names.targetNamespace,
    targetNamespaceId: row.targetNamespaceId,
    proposedBy: row.proposedBy,
    status: row.status as RepositoryTransferStatus,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedBy: row.resolvedBy ?? null,
    expiresAt: new Date(createdMs + TRANSFER_PENDING_TTL_MS).toISOString(),
  }
}

async function destMembershipSets(
  tx: Tx,
  namespaceId: string,
): Promise<{
  userKeys: Set<string>
  groupKeys: Set<string>
  members: Array<{ kind: 'user' | 'group'; key: string }>
}> {
  const users = await tx
    .select({ key: namespaceMembers.userKey })
    .from(namespaceMembers)
    .where(eq(namespaceMembers.namespaceId, namespaceId))
  const groups = await tx
    .select({ key: namespaceGroupMembers.groupKey })
    .from(namespaceGroupMembers)
    .where(eq(namespaceGroupMembers.namespaceId, namespaceId))
  return {
    userKeys: new Set(users.map((u) => u.key)),
    groupKeys: new Set(groups.map((g) => g.key)),
    members: [
      ...users.map((u) => ({ kind: 'user' as const, key: u.key })),
      ...groups.map((g) => ({ kind: 'group' as const, key: g.key })),
    ],
  }
}

async function loadAccessInputs(tx: Tx, repositoryId: string, targetNamespaceId: string, destBasePermission: BasePermission) {
  const collabUsers = await tx
    .select()
    .from(repoCollaborators)
    .where(eq(repoCollaborators.repositoryId, repositoryId))
  const collabGroups = await tx
    .select()
    .from(repoGroupCollaborators)
    .where(eq(repoGroupCollaborators.repositoryId, repositoryId))
  const approverRows = await tx
    .select({ key: repoApprovers.userKey })
    .from(repoApprovers)
    .where(eq(repoApprovers.repositoryId, repositoryId))
  const dest = await destMembershipSets(tx, targetNamespaceId)
  return partitionTransferAccess({
    collaborators: [
      ...collabUsers.map((r) => ({ kind: 'user' as const, key: r.userKey, role: r.role })),
      ...collabGroups.map((r) => ({ kind: 'group' as const, key: r.groupKey, role: r.role })),
    ],
    approvers: approverRows.map((r) =>
      isUserApproverStorageKey(r.key)
        ? { kind: 'user' as const, key: r.key }
        : { kind: 'group' as const, key: r.key },
    ),
    destMemberUserKeys: dest.userKeys,
    destMemberGroupKeys: dest.groupKeys,
    destBasePermission,
    destMembers: dest.members,
  })
}

async function recordCollaboratorVersion(tx: Tx, repositoryId: string, at: Date): Promise<void> {
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
      const users = await tx.select().from(repoCollaborators).where(eq(repoCollaborators.repositoryId, repositoryId))
      const groups = await tx
        .select()
        .from(repoGroupCollaborators)
        .where(eq(repoGroupCollaborators.repositoryId, repositoryId))
      const collaborators = [
        ...users.map((r) => ({ kind: 'user' as const, key: r.userKey, role: r.role })),
        ...groups.map((r) => ({ kind: 'group' as const, key: r.groupKey, role: r.role })),
      ].sort((a, b) =>
        a.kind !== b.kind ? a.kind.localeCompare(b.kind) : a.key.localeCompare(b.key),
      )
      await tx.insert(repoCollaboratorVersions).values({
        repositoryId,
        collaborators,
        validFrom: when,
        validTo: null,
        createdAt: when,
      })
    },
  })
}

async function recordRepoApproverVersion(tx: Tx, repositoryId: string, at: Date): Promise<void> {
  await appendVersionInterval({
    at,
    closeOpen: async (when) => {
      await tx
        .update(repoApproverVersions)
        .set({ validTo: when })
        .where(and(eq(repoApproverVersions.repositoryId, repositoryId), isNull(repoApproverVersions.validTo)))
    },
    openNext: async (when) => {
      const rows = await tx
        .select({ k: repoApprovers.userKey })
        .from(repoApprovers)
        .where(eq(repoApprovers.repositoryId, repositoryId))
      const approvers = rows.map((r) => r.k).sort((a, b) => a.localeCompare(b))
      await tx.insert(repoApproverVersions).values({
        repositoryId,
        approvers,
        validFrom: when,
        validTo: null,
        createdAt: when,
      })
    },
  })
}

/** Drop collaborators / repo-scoped approvers that are not dest members; record versions when changed. */
async function applyAccessFilter(
  tx: Tx,
  repositoryId: string,
  accessDiff: TransferAccessDiff,
  at: Date,
): Promise<void> {
  const dropCollabUsers = accessDiff.dropped
    .filter((s) => s.seat === 'collaborator' && s.kind === 'user')
    .map((s) => s.key)
  const dropCollabGroups = accessDiff.dropped
    .filter((s) => s.seat === 'collaborator' && s.kind === 'group')
    .map((s) => s.key)
  const dropApprovers = accessDiff.dropped.filter((s) => s.seat === 'approver').map((s) => s.key)

  let collabChanged = false
  if (dropCollabUsers.length) {
    await tx
      .delete(repoCollaborators)
      .where(
        and(
          eq(repoCollaborators.repositoryId, repositoryId),
          inArray(repoCollaborators.userKey, dropCollabUsers),
        ),
      )
    collabChanged = true
  }
  if (dropCollabGroups.length) {
    await tx
      .delete(repoGroupCollaborators)
      .where(
        and(
          eq(repoGroupCollaborators.repositoryId, repositoryId),
          inArray(repoGroupCollaborators.groupKey, dropCollabGroups),
        ),
      )
    collabChanged = true
  }
  if (collabChanged) await recordCollaboratorVersion(tx, repositoryId, at)

  if (dropApprovers.length) {
    await tx
      .delete(repoApprovers)
      .where(and(eq(repoApprovers.repositoryId, repositoryId), inArray(repoApprovers.userKey, dropApprovers)))
    await recordRepoApproverVersion(tx, repositoryId, at)
  }
}

async function resolvePendingRow(
  tx: Tx,
  transferId: string,
  status: Exclude<RepositoryTransferStatus, 'pending'>,
  resolvedBy: string,
  at: Date,
): Promise<void> {
  await tx
    .update(repositoryTransfers)
    .set({ status, resolvedAt: at, resolvedBy })
    .where(eq(repositoryTransfers.id, transferId))
}

/**
 * AuthZ namespace re-point on a stable repository id (mirrors rename: no oxen move).
 * Applies the dest-membership access filter and clears any pending transfer.
 */
export async function transferRepository(
  ns: string,
  name: string,
  targetNamespace: string,
  opts?: {
    mode?: 'one-shot' | 'accept'
    actorKey?: string
    pendingTransferId?: string
  },
): Promise<TransferCompleteResult> {
  const target = targetNamespace.trim()
  if (!target) return { ok: false, error: 'Target namespace required', code: 'target_required' }
  if (target === ns) {
    return { ok: false, error: 'Cannot transfer to the same namespace', code: 'same_namespace' }
  }

  return inTransaction(async (tx) => {
    const rows = await tx
      .select({
        repo: repositories,
        sourceNsId: namespaces.id,
        sourceNsName: namespaces.name,
      })
      .from(repositories)
      .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
      .where(and(eq(namespaces.name, ns), eq(repositories.name, name)))
      .for('update')
    if (!rows[0]) return { ok: false, error: 'Repository not found', code: 'not_found' } as const
    const { repo, sourceNsId, sourceNsName } = rows[0]

    const destRows = await tx
      .select()
      .from(namespaces)
      .where(eq(namespaces.name, target))
      .limit(1)
      .for('update')
    const dest = destRows[0]
    if (!dest) {
      return { ok: false, error: 'Destination namespace not found', code: 'dest_not_found' } as const
    }

    const collision = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.namespaceId, dest.id), eq(repositories.name, repo.name)))
      .limit(1)
    if (collision[0] && collision[0].id !== repo.id) {
      return {
        ok: false,
        error: 'A repository with this name already exists in the destination namespace',
        code: 'name_collision',
      } as const
    }

    const at = new Date()
    const accessDiff = await loadAccessInputs(tx, repo.id, dest.id, dest.basePermission as BasePermission)

    try {
      await tx
        .update(repositories)
        .set({ namespaceId: dest.id, updatedAt: at })
        .where(eq(repositories.id, repo.id))
    } catch (e) {
      if (isUniqueViolation(e)) {
        return { ok: false, error: 'Repository already exists', code: 'name_collision' } as const
      }
      throw e
    }

    await applyAccessFilter(tx, repo.id, accessDiff, at)

    if (opts?.pendingTransferId) {
      await resolvePendingRow(tx, opts.pendingTransferId, 'accepted', opts.actorKey ?? '', at)
    } else {
      // Clear any stray pending row for this repo (one-shot while pending is refused at propose).
      await tx
        .update(repositoryTransfers)
        .set({
          status: 'accepted',
          resolvedAt: at,
          resolvedBy: opts?.actorKey ?? null,
        })
        .where(
          and(eq(repositoryTransfers.repositoryId, repo.id), eq(repositoryTransfers.status, 'pending')),
        )
    }

    const repository: RepositoryRecord = {
      id: repo.id,
      namespaceId: dest.id,
      namespace: dest.name,
      name: repo.name,
      description: repo.description ?? '',
      createdAt: repo.createdAt.toISOString(),
      updatedAt: at.toISOString(),
    }
    // Silence unused — source identity is validated via the locked row.
    void sourceNsId
    void sourceNsName
    return {
      ok: true as const,
      repository,
      accessDiff,
      mode: opts?.mode ?? 'one-shot',
    }
  })
}

/** Access-diff preview for a proposed destination (no mutation). */
export async function previewRepositoryTransfer(
  ns: string,
  name: string,
  targetNamespace: string,
): Promise<{ ok: true; accessDiff: TransferAccessDiff; targetNamespace: string } | { ok: false; error: string; code?: string }> {
  const target = targetNamespace.trim()
  if (!target) return { ok: false, error: 'Target namespace required', code: 'target_required' }
  if (target === ns) {
    return { ok: false, error: 'Cannot transfer to the same namespace', code: 'same_namespace' }
  }
  const repo = await readRepository(ns, name)
  if (!repo) return { ok: false, error: 'Repository not found', code: 'not_found' }
  const dest = await readNamespace(target)
  if (!dest) return { ok: false, error: 'Destination namespace not found', code: 'dest_not_found' }
  if (await namespaceIdByName(target)) {
    const collision = await getDb()
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.namespaceId, dest.id), eq(repositories.name, repo.name)))
      .limit(1)
    if (collision[0] && collision[0].id !== repo.id) {
      return {
        ok: false,
        error: 'A repository with this name already exists in the destination namespace',
        code: 'name_collision',
      }
    }
  }
  return inTransaction(async (tx) => {
    const accessDiff = await loadAccessInputs(
      tx,
      repo.id,
      dest.id,
      dest.basePermission as BasePermission,
    )
    return { ok: true as const, accessDiff, targetNamespace: dest.name }
  })
}

async function loadTransferNames(row: typeof repositoryTransfers.$inferSelect): Promise<{
  repositoryName: string
  sourceNamespace: string
  targetNamespace: string
} | null> {
  const repoRows = await getDb()
    .select({ name: repositories.name })
    .from(repositories)
    .where(eq(repositories.id, row.repositoryId))
    .limit(1)
  const sourceRows = await getDb()
    .select({ name: namespaces.name })
    .from(namespaces)
    .where(eq(namespaces.id, row.sourceNamespaceId))
    .limit(1)
  const targetRows = await getDb()
    .select({ name: namespaces.name })
    .from(namespaces)
    .where(eq(namespaces.id, row.targetNamespaceId))
    .limit(1)
  if (!repoRows[0] || !sourceRows[0] || !targetRows[0]) return null
  return {
    repositoryName: repoRows[0].name,
    sourceNamespace: sourceRows[0].name,
    targetNamespace: targetRows[0].name,
  }
}

export async function getPendingRepositoryTransfer(
  ns: string,
  name: string,
  now = Date.now(),
): Promise<RepositoryTransferRecord | null> {
  await expirePendingTransfers({ now, repositoryNs: ns, repositoryName: name })
  const repo = await readRepository(ns, name)
  if (!repo) return null
  const rows = await getDb()
    .select()
    .from(repositoryTransfers)
    .where(and(eq(repositoryTransfers.repositoryId, repo.id), eq(repositoryTransfers.status, 'pending')))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const names = await loadTransferNames(row)
  if (!names) return null
  return toTransfer(row, names)
}

export async function listIncomingPendingTransfers(
  targetNamespace: string,
  now = Date.now(),
): Promise<RepositoryTransferRecord[]> {
  await expirePendingTransfers({ now, targetNamespace })
  const destId = await namespaceIdByName(targetNamespace)
  if (!destId) return []
  const rows = await getDb()
    .select()
    .from(repositoryTransfers)
    .where(
      and(eq(repositoryTransfers.targetNamespaceId, destId), eq(repositoryTransfers.status, 'pending')),
    )
  const out: RepositoryTransferRecord[] = []
  for (const row of rows) {
    const names = await loadTransferNames(row)
    if (names) out.push(toTransfer(row, names))
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/**
 * Propose a transfer. Caller must already be source namespace Owner.
 * When `initiatorIsDestOwner`, completes immediately (one-shot).
 */
export async function proposeRepositoryTransfer(input: {
  ns: string
  name: string
  targetNamespace: string
  proposedBy: string
  initiatorIsDestOwner: boolean
}): Promise<TransferProposeResult> {
  const target = input.targetNamespace.trim()
  if (!target) return { ok: false, error: 'Target namespace required', code: 'target_required' }
  if (target === input.ns) {
    return { ok: false, error: 'Cannot transfer to the same namespace', code: 'same_namespace' }
  }

  if (input.initiatorIsDestOwner) {
    const completed = await transferRepository(input.ns, input.name, target, {
      mode: 'one-shot',
      actorKey: input.proposedBy,
    })
    if (!completed.ok) return completed
    return {
      ok: true,
      mode: 'one-shot',
      repository: completed.repository,
      accessDiff: completed.accessDiff,
    }
  }

  return inTransaction(async (tx) => {
    const rows = await tx
      .select({ repo: repositories, sourceNsId: namespaces.id })
      .from(repositories)
      .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
      .where(and(eq(namespaces.name, input.ns), eq(repositories.name, input.name)))
      .for('update')
    if (!rows[0]) return { ok: false, error: 'Repository not found', code: 'not_found' } as const
    const { repo, sourceNsId } = rows[0]

    const destRows = await tx.select().from(namespaces).where(eq(namespaces.name, target)).limit(1)
    const dest = destRows[0]
    if (!dest) {
      return { ok: false, error: 'Destination namespace not found', code: 'dest_not_found' } as const
    }

    const collision = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.namespaceId, dest.id), eq(repositories.name, repo.name)))
      .limit(1)
    if (collision[0]) {
      return {
        ok: false,
        error: 'A repository with this name already exists in the destination namespace',
        code: 'name_collision',
      } as const
    }

    const existing = await tx
      .select()
      .from(repositoryTransfers)
      .where(and(eq(repositoryTransfers.repositoryId, repo.id), eq(repositoryTransfers.status, 'pending')))
      .limit(1)
    if (existing[0]) {
      return {
        ok: false,
        error: 'A transfer is already pending for this repository',
        code: 'pending_exists',
      } as const
    }

    const at = new Date()
    const accessDiff = await loadAccessInputs(tx, repo.id, dest.id, dest.basePermission as BasePermission)
    const id = randomUUID()
    try {
      await tx.insert(repositoryTransfers).values({
        id,
        repositoryId: repo.id,
        sourceNamespaceId: sourceNsId,
        targetNamespaceId: dest.id,
        proposedBy: input.proposedBy,
        status: 'pending',
        createdAt: at,
        resolvedAt: null,
        resolvedBy: null,
      })
    } catch (e) {
      if (isUniqueViolation(e)) {
        return {
          ok: false,
          error: 'A transfer is already pending for this repository',
          code: 'pending_exists',
        } as const
      }
      throw e
    }

    return {
      ok: true as const,
      mode: 'pending' as const,
      transfer: toTransfer(
        {
          id,
          repositoryId: repo.id,
          sourceNamespaceId: sourceNsId,
          targetNamespaceId: dest.id,
          proposedBy: input.proposedBy,
          status: 'pending',
          createdAt: at,
          resolvedAt: null,
          resolvedBy: null,
        },
        {
          repositoryName: repo.name,
          sourceNamespace: input.ns,
          targetNamespace: dest.name,
        },
      ),
      accessDiff,
    }
  })
}

export async function acceptRepositoryTransfer(input: {
  ns: string
  name: string
  actorKey: string
}): Promise<TransferCompleteResult> {
  await expirePendingTransfers({
    now: Date.now(),
    repositoryNs: input.ns,
    repositoryName: input.name,
  })
  const pending = await getPendingRepositoryTransfer(input.ns, input.name)
  if (!pending) return { ok: false, error: 'No pending transfer', code: 'no_pending' }
  return transferRepository(input.ns, input.name, pending.targetNamespace, {
    mode: 'accept',
    actorKey: input.actorKey,
    pendingTransferId: pending.id,
  })
}

async function resolvePendingByAction(input: {
  ns: string
  name: string
  actorKey: string
  status: 'rejected' | 'cancelled'
}): Promise<Result & { code?: string; transfer?: RepositoryTransferRecord }> {
  await expirePendingTransfers({
    now: Date.now(),
    repositoryNs: input.ns,
    repositoryName: input.name,
  })
  return inTransaction(async (tx) => {
    const rows = await tx
      .select({
        transfer: repositoryTransfers,
        repoName: repositories.name,
        sourceName: namespaces.name,
      })
      .from(repositoryTransfers)
      .innerJoin(repositories, eq(repositories.id, repositoryTransfers.repositoryId))
      .innerJoin(namespaces, eq(namespaces.id, repositoryTransfers.sourceNamespaceId))
      .where(
        and(
          eq(namespaces.name, input.ns),
          eq(repositories.name, input.name),
          eq(repositoryTransfers.status, 'pending'),
        ),
      )
      .for('update')
    if (!rows[0]) return { ok: false, error: 'No pending transfer', code: 'no_pending' } as const
    const { transfer, repoName } = rows[0]
    const targetRows = await tx
      .select({ name: namespaces.name })
      .from(namespaces)
      .where(eq(namespaces.id, transfer.targetNamespaceId))
      .limit(1)
    const at = new Date()
    await resolvePendingRow(tx, transfer.id, input.status, input.actorKey, at)
    return {
      ok: true as const,
      transfer: toTransfer(
        { ...transfer, status: input.status, resolvedAt: at, resolvedBy: input.actorKey },
        {
          repositoryName: repoName,
          sourceNamespace: input.ns,
          targetNamespace: targetRows[0]?.name ?? '',
        },
      ),
    }
  })
}

export async function rejectRepositoryTransfer(input: {
  ns: string
  name: string
  actorKey: string
}): Promise<Result & { code?: string; transfer?: RepositoryTransferRecord }> {
  return resolvePendingByAction({ ...input, status: 'rejected' })
}

export async function cancelRepositoryTransfer(input: {
  ns: string
  name: string
  actorKey: string
}): Promise<Result & { code?: string; transfer?: RepositoryTransferRecord }> {
  return resolvePendingByAction({ ...input, status: 'cancelled' })
}

export type ExpiredTransfer = {
  id: string
  repositoryId: string
  sourceNamespace: string
  targetNamespace: string
  repositoryName: string
}

/**
 * Auto-cancel pending transfers older than 7 days. Audited by the caller.
 */
export async function expirePendingTransfers(opts?: {
  now?: number
  repositoryNs?: string
  repositoryName?: string
  targetNamespace?: string
}): Promise<ExpiredTransfer[]> {
  const now = opts?.now ?? Date.now()
  const cutoff = new Date(now - TRANSFER_PENDING_TTL_MS)
  return inTransaction(async (tx) => {
    const conditions = [
      eq(repositoryTransfers.status, 'pending'),
      lt(repositoryTransfers.createdAt, cutoff),
    ]
    if (opts?.repositoryNs && opts?.repositoryName) {
      const repoRows = await tx
        .select({ id: repositories.id })
        .from(repositories)
        .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
        .where(and(eq(namespaces.name, opts.repositoryNs), eq(repositories.name, opts.repositoryName)))
        .limit(1)
      if (!repoRows[0]) return []
      conditions.push(eq(repositoryTransfers.repositoryId, repoRows[0].id))
    }
    if (opts?.targetNamespace) {
      const destId = await namespaceIdByName(opts.targetNamespace)
      if (!destId) return []
      conditions.push(eq(repositoryTransfers.targetNamespaceId, destId))
    }

    const rows = await tx
      .select()
      .from(repositoryTransfers)
      .where(and(...conditions))
      .for('update')
    if (!rows.length) return []

    const at = new Date(now)
    const expired: ExpiredTransfer[] = []
    for (const row of rows) {
      await resolvePendingRow(tx, row.id, 'expired', 'system', at)
      const names = await loadTransferNames(row)
      expired.push({
        id: row.id,
        repositoryId: row.repositoryId,
        sourceNamespace: names?.sourceNamespace ?? '',
        targetNamespace: names?.targetNamespace ?? '',
        repositoryName: names?.repositoryName ?? '',
      })
    }
    return expired
  })
}

/** Test helper: force a pending row's createdAt into the past. */
export async function backdatePendingTransfer(transferId: string, createdAt: Date): Promise<void> {
  await getDb()
    .update(repositoryTransfers)
    .set({ createdAt })
    .where(eq(repositoryTransfers.id, transferId))
}
