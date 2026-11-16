import { and, eq } from 'drizzle-orm'
import { decideIsApprover } from './authzApproverStore.js'
import { readRepository } from './authzRepository.js'
import { parseUserKey } from './authzTypes.js'
import { principalKey } from './authentication/session/principal.js'
import { signatureStore, type SignatureRecord } from './authentication/signing/signatureStore.js'
import { getCommitQc, markCommitsQc } from './commitQcStore.js'
import { getDb } from './db/database.js'
import { mergeRequests, namespaceMembers, namespaces } from './db/schema.js'
import { getMergeRequest, listMergeRequests } from './mergeRequestStore.js'
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
  revoker: { iss: string; sub: string; name?: string }
  reason: string
  changeControlId: string
  mergeRequestId?: string
  notify?: (event: NotificationEvent) => Promise<void>
}

export type RevokeSignatureResult =
  | { ok: true; revocation: SignatureRevocation; blockedMergeRequestIds: string[] }
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

  const commitIds =
    input.commitIds && input.commitIds.length > 0
      ? [...new Set(input.commitIds)]
      : [record.binding!.sourceHead, record.binding!.targetHead].filter(Boolean)

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

  const repositoryId = await resolveRepositoryId(ns, repoName, input.mergeRequestId)
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
        .set({ status: 'blocked', updatedAt: new Date() })
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
        .set({ status: 'blocked', updatedAt: new Date() })
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
