import { and, eq } from 'drizzle-orm'
import { decideIsApprover } from './authzApproverStore.js'
import { readRepository } from './authzRepository.js'
import { parseUserKey } from './authzTypes.js'
import { principalKey } from './authentication/session/principal.js'
import { signatureStore, type SignatureRecord } from './authentication/signing/signatureStore.js'
import { getCommitQc, listCommitQcForRepo, markCommitsQc } from './commitQcStore.js'
import { getDb } from './db/database.js'
import { mergeRequests, namespaceMembers, namespaces, signatureIndex } from './db/schema.js'
import {
  getMergeRequest,
  listMergeRequests,
  type MergeRequestRecord,
} from './mergeRequestStore.js'
import { emitNotification } from './notifications.js'
import type { NotificationEvent } from './notificationsTypes.js'

export type SignatureRevocation = {
  kind: 'esign.revoked'
  id: string
  signatureId: string
  revokedAt: string
  revokedBy: { iss: string; sub: string; name?: string }
  reason: string
  changeControlId: string
  commitIds: string[]
}

export type RevokeSignatureInput = {
  signatureId: string
  commitIds?: string[]
  /** Session identity; include IdP groups so group approver seats resolve. */
  revoker: { iss: string; sub: string; name?: string; groups?: string[] }
  reason: string
  changeControlId: string
  mergeRequestId?: string
  notify?: (event: NotificationEvent) => Promise<void>
}

export type RevokeSignatureResult =
  | { ok: true; revocation: SignatureRevocation; blockedMergeRequestIds: string[] }
  | { ok: false; status: number; code: string; detail: string }

export type SignatureRevocationRevert = {
  kind: 'esign.revocation_reverted'
  id: string
  signatureId: string
  revocationId: string
  revertedAt: string
  revertedBy: { iss: string; sub: string; name?: string }
  reason: string
  changeControlId: string
  restoredCommitIds: string[]
}

export type RevertSignatureRevocationInput = {
  signatureId: string
  revocationId: string
  reverter: { iss: string; sub: string; name?: string; groups?: string[] }
  reason: string
  changeControlId: string
  notify?: (event: NotificationEvent) => Promise<void>
}

export type RevertSignatureRevocationResult =
  | { ok: true; revert: SignatureRevocationRevert }
  | { ok: false; status: number; code: string; detail: string }

/**
 * Append-only revoke: original signature stays; linked `esign.revoked` is written;
 * affected commits become QC Failed (gxp/07). Pre-merge revoke can block open MRs (gxp/08).
 */
export async function revokeSignature(input: RevokeSignatureInput): Promise<RevokeSignatureResult> {
  const store = await signatureStore()
  const found = await store.get(input.signatureId)
  if (!found) {
    return { ok: false, status: 404, code: 'not_found', detail: 'Signature not found' }
  }
  const record = found.record
  const repoPath = record.binding?.repo
  if (!repoPath?.includes('/')) {
    return {
      ok: false,
      status: 400,
      code: 'no_binding',
      detail: 'Signature has no repository binding to revoke against',
    }
  }
  const [ns, repoName] = repoPath.split('/') as [string, string]
  const approver = await decideIsApprover(input.revoker, ns, repoName)
  if (!approver.allow) {
    return { ok: false, status: 403, code: 'not_approver', detail: approver.reason }
  }

  const repositoryId = await resolveRepositoryId(ns, repoName, input.mergeRequestId)
  const commitIds = await resolveAffectedCommitIds({
    explicit: input.commitIds,
    binding: record.binding!,
    repositoryId,
    mergeRequestId: input.mergeRequestId,
    signatureId: input.signatureId,
  })

  const saved = await store.revoke({
    signatureId: input.signatureId,
    revokedBy: input.revoker,
    reason: input.reason,
    changeControlId: input.changeControlId,
    commitIds,
  })
  const listed = await store.listRevocations(input.signatureId)
  const row = listed.find((r) => r.id === saved.id)
  const revocation: SignatureRevocation = {
    kind: 'esign.revoked',
    id: saved.id,
    signatureId: input.signatureId,
    revokedAt: row?.revokedAt ?? new Date().toISOString(),
    revokedBy: input.revoker,
    reason: input.reason,
    changeControlId: input.changeControlId,
    commitIds,
  }

  if (repositoryId) {
    await markCommitsQc(repositoryId, commitIds, 'failed')
  }

  const blockedMergeRequestIds = await blockOpenMergeRequests({
    repositoryId,
    mergeRequestId: input.mergeRequestId,
    commitIds,
  })

  const notify = input.notify ?? emitNotification
  try {
    await notifyRevocation({ notify, ns, repo: repoName, signature: record, revocation })
  } catch {
    // Notification failure must not roll back the revocation record (gxp/09).
  }

  return { ok: true, revocation, blockedMergeRequestIds }
}

/**
 * Append-only revert of a prior revocation (gxp/10a #159).
 * Original signature and revoke remain; commits failed only by that revocation return to QC Passed.
 */
export async function revertSignatureRevocation(
  input: RevertSignatureRevocationInput,
): Promise<RevertSignatureRevocationResult> {
  const store = await signatureStore()
  const found = await store.get(input.signatureId)
  if (!found) {
    return { ok: false, status: 404, code: 'not_found', detail: 'Signature not found' }
  }
  const record = found.record
  const repoPath = record.binding?.repo
  if (!repoPath?.includes('/')) {
    return {
      ok: false,
      status: 400,
      code: 'no_binding',
      detail: 'Signature has no repository binding to revert against',
    }
  }
  const [ns, repoName] = repoPath.split('/') as [string, string]
  const approver = await decideIsApprover(input.reverter, ns, repoName)
  if (!approver.allow) {
    return { ok: false, status: 403, code: 'not_approver', detail: approver.reason }
  }

  const revocations = await store.listRevocations(input.signatureId)
  const target = revocations.find((r) => r.id === input.revocationId)
  if (!target) {
    return {
      ok: false,
      status: 404,
      code: 'revocation_not_found',
      detail: 'Revocation not found for this signature',
    }
  }

  const priorReverts = await store.listRevocationReverts(input.signatureId)
  if (priorReverts.some((r) => r.revocationId === input.revocationId)) {
    return {
      ok: false,
      status: 409,
      code: 'already_reverted',
      detail: 'This revocation was already reverted',
    }
  }

  const saved = await store.revertRevocation({
    signatureId: input.signatureId,
    revocationId: input.revocationId,
    revertedBy: input.reverter,
    reason: input.reason,
    changeControlId: input.changeControlId,
  })
  const listed = await store.listRevocationReverts(input.signatureId)
  const row = listed.find((r) => r.id === saved.id)

  const revertedIds = new Set(listed.map((r) => r.revocationId))
  const stillCovered = new Set<string>()
  for (const rev of revocations) {
    if (rev.id === input.revocationId) continue
    if (revertedIds.has(rev.id)) continue
    for (const commitId of rev.commitIds) stillCovered.add(commitId)
  }
  const restoredCommitIds = target.commitIds.filter((id) => !stillCovered.has(id))

  const repositoryId = await resolveRepositoryId(ns, repoName, undefined)
  if (repositoryId && restoredCommitIds.length > 0) {
    await markCommitsQc(repositoryId, restoredCommitIds, 'passed', {
      allowFailedToPassed: true,
    })
  }

  const revert: SignatureRevocationRevert = {
    kind: 'esign.revocation_reverted',
    id: saved.id,
    signatureId: input.signatureId,
    revocationId: input.revocationId,
    revertedAt: row?.revertedAt ?? new Date().toISOString(),
    revertedBy: input.reverter,
    reason: input.reason,
    changeControlId: input.changeControlId,
    restoredCommitIds,
  }

  const notify = input.notify ?? emitNotification
  try {
    await notifyRevocationRevert({ notify, ns, repo: repoName, signature: record, revert })
  } catch {
    // Notification failure must not roll back the revert record (align with gxp/09).
  }

  return { ok: true, revert }
}

async function notifyRevocationRevert(input: {
  notify: (event: NotificationEvent) => Promise<void>
  ns: string
  repo: string
  signature: SignatureRecord
  revert: SignatureRevocationRevert
}): Promise<void> {
  const recipients: Array<{ iss: string; sub: string }> = []
  for (const key of await listOwnerKeys(input.ns)) {
    try {
      recipients.push(parseUserKey(key))
    } catch {
      /* ignore */
    }
  }
  recipients.push({
    iss: input.signature.signer.iss,
    sub: input.signature.signer.sub,
  })
  const unique = new Map(recipients.map((r) => [principalKey(r), r]))
  await input.notify({
    id: `sig-revert-${input.revert.id}`,
    category: 'security',
    title: 'Signature revocation reverted',
    summary: `Revocation of signature ${input.revert.signatureId.slice(0, 8)}… on ${input.ns}/${input.repo} reverted: ${input.revert.reason}`,
    createdAt: new Date().toISOString(),
    audience: 'personal',
    recipients: [...unique.values()],
    resource: {
      type: 'repository',
      namespace: input.ns,
      repo: input.repo,
      id: `${input.ns}/${input.repo}`,
    },
    href: `/repos/${input.ns}/${input.repo}`,
  })
}

async function resolveRepositoryId(
  ns: string,
  repo: string,
  mergeRequestId?: string,
): Promise<string | null> {
  if (mergeRequestId) {
    const mr = await getMergeRequest(mergeRequestId)
    if (mr) return mr.repositoryId
  }
  return (await readRepository(ns, repo))?.id ?? null
}

/**
 * Explicit commit set wins (partial revoke). Otherwise whole-signature revoke
 * fails the signed merge's incoming commits + merge commit (gxp/08) — not the
 * pre-merge target tip alone.
 */
async function resolveAffectedCommitIds(input: {
  explicit?: string[]
  binding: { sourceHead: string; targetHead: string }
  repositoryId: string | null
  mergeRequestId?: string
  signatureId?: string
}): Promise<string[]> {
  if (input.explicit && input.explicit.length > 0) {
    return [...new Set(input.explicit)]
  }
  const fromMerge = await commitIdsFromSignedMergeQc(input)
  if (fromMerge.length > 0) return fromMerge
  // Last resort: incoming tip only (never treat target tip as the sole Failed set).
  return [input.binding.sourceHead].filter(Boolean)
}

async function findMergedMrForBinding(input: {
  binding: { sourceHead: string; targetHead: string }
  repositoryId: string
  mergeRequestId?: string
  signatureId?: string
}): Promise<MergeRequestRecord | undefined> {
  if (input.mergeRequestId) {
    const mr = await getMergeRequest(input.mergeRequestId)
    if (mr) return mr
  }
  const all = await listMergeRequests(input.repositoryId)
  const byHeads = all.find(
    (row) =>
      row.status === 'merged' &&
      row.expectedSourceHead === input.binding.sourceHead &&
      row.expectedTargetHead === input.binding.targetHead,
  )
  if (byHeads) return byHeads

  if (input.signatureId) {
    for (const row of all.filter((r) => r.status === 'merged')) {
      const ref = await resolveSignatureForMergeRequest(row)
      if (ref?.signatureId === input.signatureId) return row
    }
  }

  const bySource = all
    .filter(
      (r) => r.status === 'merged' && r.expectedSourceHead === input.binding.sourceHead,
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  return bySource[0]
}

async function commitIdsFromSignedMergeQc(input: {
  binding: { sourceHead: string; targetHead: string }
  repositoryId: string | null
  mergeRequestId?: string
  signatureId?: string
}): Promise<string[]> {
  if (!input.repositoryId) return []
  const mr = await findMergedMrForBinding({
    binding: input.binding,
    repositoryId: input.repositoryId,
    mergeRequestId: input.mergeRequestId,
    signatureId: input.signatureId,
  })
  if (!mr) return []

  const rows = await listCommitQcForRepo(input.repositoryId)
  const fromQc = rows
    .filter((r) => r.mergeRequestId === mr.id && (r.status === 'passed' || r.status === 'failed'))
    .map((r) => r.commitId)

  // Incoming commits that entered the validated branch — never the pre-merge target tip.
  const incoming = [
    ...fromQc,
    input.binding.sourceHead,
    mr.expectedSourceHead,
    mr.mergeCommitId,
  ].filter((id): id is string => Boolean(id) && id !== input.binding.targetHead)

  return [...new Set(incoming)]
}

async function blockOpenMergeRequests(input: {
  repositoryId: string | null
  mergeRequestId?: string
  commitIds: string[]
}): Promise<string[]> {
  const blocked: string[] = []
  if (input.mergeRequestId) {
    const mr = await getMergeRequest(input.mergeRequestId)
    if (mr && (mr.status === 'open' || mr.status === 'stale')) {
      await getDb()
        .update(mergeRequests)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(mergeRequests.id, mr.id))
      blocked.push(mr.id)
    }
    return blocked
  }
  if (!input.repositoryId) return blocked
  for (const mr of await listMergeRequests(input.repositoryId)) {
    if (mr.status !== 'open' && mr.status !== 'stale') continue
    if (
      input.commitIds.includes(mr.expectedSourceHead) ||
      input.commitIds.includes(mr.expectedTargetHead)
    ) {
      await getDb()
        .update(mergeRequests)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(mergeRequests.id, mr.id))
      blocked.push(mr.id)
    }
  }
  return blocked
}

async function listOwnerKeys(ns: string): Promise<string[]> {
  const owners = await getDb()
    .select({ userKey: namespaceMembers.userKey, role: namespaceMembers.role })
    .from(namespaceMembers)
    .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
    .where(and(eq(namespaces.name, ns), eq(namespaceMembers.role, 'owner')))
  return owners.map((r) => r.userKey)
}

async function notifyRevocation(input: {
  notify: (event: NotificationEvent) => Promise<void>
  ns: string
  repo: string
  signature: SignatureRecord
  revocation: SignatureRevocation
}): Promise<void> {
  const recipients: Array<{ iss: string; sub: string }> = []
  for (const key of await listOwnerKeys(input.ns)) {
    try {
      recipients.push(parseUserKey(key))
    } catch {
      /* ignore */
    }
  }
  recipients.push({
    iss: input.signature.signer.iss,
    sub: input.signature.signer.sub,
  })
  const unique = new Map(recipients.map((r) => [principalKey(r), r]))
  await input.notify({
    id: `sig-revoke-${input.revocation.id}`,
    category: 'security',
    title: 'Signature revoked',
    summary: `Signature ${input.revocation.signatureId.slice(0, 8)}… on ${input.ns}/${input.repo} revoked: ${input.revocation.reason}`,
    createdAt: new Date().toISOString(),
    audience: 'personal',
    recipients: [...unique.values()],
    resource: {
      type: 'repository',
      namespace: input.ns,
      repo: input.repo,
      id: `${input.ns}/${input.repo}`,
    },
    href: `/repos/${input.ns}/${input.repo}`,
  })
}

/** Used by complete path (gxp/08): refuse if any listed commit is already QC Failed. */
export async function anyCommitQcFailed(
  repositoryId: string,
  commitIds: string[],
): Promise<boolean> {
  for (const id of commitIds) {
    if ((await getCommitQc(repositoryId, id)) === 'failed') return true
  }
  return false
}

export type ResolvedSignatureRef = {
  signatureId: string
  revoked: boolean
}

/**
 * Locate the approval signature that completed this merge request (heads match).
 * Uses the SQL signature_index (not a full ledger walk per candidate) so Merged-tab
 * list enrichment stays fast (#93).
 */
export async function resolveSignatureForMergeRequest(
  mr: Pick<
    MergeRequestRecord,
    'namespace' | 'repo' | 'expectedSourceHead' | 'expectedTargetHead' | 'mergeCommitId' | 'id'
  >,
  revokedIds?: Set<string>,
): Promise<ResolvedSignatureRef | null> {
  const rows = await getDb()
    .select({
      signatureId: signatureIndex.signatureId,
      signedAt: signatureIndex.signedAt,
    })
    .from(signatureIndex)
    .where(
      and(
        eq(signatureIndex.repo, `${mr.namespace}/${mr.repo}`),
        eq(signatureIndex.sourceHead, mr.expectedSourceHead),
        eq(signatureIndex.targetHead, mr.expectedTargetHead),
      ),
    )
  if (rows.length === 0) return null
  const revoked = revokedIds ?? (await (await signatureStore()).listRevokedSignatureIds())
  // Prefer a still-active signature; then the newest match.
  rows.sort((a, b) => (a.signedAt < b.signedAt ? 1 : -1))
  let best: ResolvedSignatureRef | null = null
  for (const row of rows) {
    const ref = {
      signatureId: row.signatureId,
      revoked: revoked.has(row.signatureId),
    }
    if (!best || (best.revoked && !ref.revoked)) best = ref
    if (!ref.revoked) break
  }
  return best
}

/**
 * Signature that covers a commit (via QC merge-request link or tip binding).
 * Used by validated-branch history Approver revoke-of-commit (#93).
 */
export async function resolveSignatureCoveringCommit(input: {
  repositoryId: string
  namespace: string
  repo: string
  commitId: string
}): Promise<ResolvedSignatureRef | null> {
  const commitId = input.commitId.trim()
  if (!commitId) return null
  const revoked = await (await signatureStore()).listRevokedSignatureIds()

  const qcRows = await listCommitQcForRepo(input.repositoryId)
  const qc = qcRows.find((r) => r.commitId === commitId)
  if (qc?.mergeRequestId) {
    const mr = await getMergeRequest(qc.mergeRequestId)
    if (mr) {
      const viaMr = await resolveSignatureForMergeRequest(mr, revoked)
      if (viaMr) return viaMr
    }
  }

  // Merge commit id on a merged MR.
  for (const mr of await listMergeRequests(input.repositoryId)) {
    if (mr.status === 'merged' && mr.mergeCommitId === commitId) {
      const viaMr = await resolveSignatureForMergeRequest(mr, revoked)
      if (viaMr) return viaMr
    }
  }

  const store = await signatureStore()
  const tipHits = await store.find({
    repo: `${input.namespace}/${input.repo}`,
    commit: commitId,
  })
  for (const row of tipHits) {
    return { signatureId: row.id, revoked: revoked.has(row.id) }
  }
  return null
}
