import { confirmPrivilegedGroups } from '../../authentication/access.js'
import { hasRepoPermission } from '../../authz/index.js'
import { readRepository } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { AuditFields } from '../../shared/index.js'
import { requireAuditChange } from '../../audit/change.js'
import { allocateChangeControlId, CHANGE_CONTROL_HEADER } from './changeControl.js'
import {
  resolveSignatureCoveringCommit,
  revertSignatureRevocation,
  revokeSignature,
} from './signatureRevoke.js'
import { buildSignedRecordReport } from './signedRecordReport.js'
import { json, type HttpOutcome, type JsonOutcome } from './httpOutcome.js'

type AuditFn = (fields: AuditFields) => void | Promise<void>

export async function coveringSignatureUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  commitId: string
}): Promise<JsonOutcome> {
  const { user, ns, repoName, commitId } = input
  if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const repo = await readRepository(ns, repoName)
  if (!repo) return json(404, { error: 'Not found' })
  const sig = await resolveSignatureCoveringCommit({
    repositoryId: repo.id,
    namespace: ns,
    repo: repoName,
    commitId,
  })
  return json(200, { signature: sig })
}

export async function signedRecordReportUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  format?: string | null
}): Promise<HttpOutcome> {
  const { user, ns, repoName, format } = input
  if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const report = await buildSignedRecordReport(`${ns}/${repoName}`)
  if (format === 'pdf') {
    return {
      raw: new Response(new Uint8Array(report.pdf), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="signed-record.pdf"',
        },
      }),
    }
  }
  return json(200, { report })
}

export async function listSignaturesUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
}): Promise<JsonOutcome> {
  const { user, ns, repoName } = input
  if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const { signatureStore } = await import('../../authentication/signing.js')
  const store = await signatureStore()
  const indexed = await store.find({ repo: `${ns}/${repoName}` })
  const signatures = []
  for (const row of indexed) {
    const found = await store.get(row.id)
    if (!found) continue
    const revs = await store.listRevocations(row.id)
    const reverts = await store.listRevocationReverts(row.id)
    const revertedIds = new Set(reverts.map((r) => r.revocationId))
    const unreverted = revs.filter((r) => !revertedIds.has(r.id))
    signatures.push({
      id: found.record.id,
      meaning: found.record.meaning,
      signedAt: found.record.signedAt,
      signer: found.record.signer,
      binding: found.record.binding,
      changeControlId: found.record.changeControlId,
      revoked: unreverted.length > 0,
      revocationCount: revs.length,
      revocationRevertCount: reverts.length,
      unrevertedRevocationIds: unreverted.map((r) => r.id),
    })
  }
  signatures.sort((a, b) => (a.signedAt < b.signedAt ? 1 : -1))
  return json(200, { signatures })
}

export async function revokeSignatureUseCase(input: {
  user: SessionUser
  signatureId: string
  reasonText: string
  changeControlHeader: string | undefined
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<JsonOutcome> {
  const body = input.body as {
    commitIds?: string[]
    mergeRequestId?: string
    changeControlId?: string
  }
  const changeControlId =
    (typeof body.changeControlId === 'string' && body.changeControlId.trim()) ||
    input.changeControlHeader?.trim() ||
    allocateChangeControlId()
  let revoker = input.user
  try {
    revoker = await confirmPrivilegedGroups(input.user)
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
      return json(503, { error: 'Directory unavailable' })
    }
    throw err
  }
  const result = await revokeSignature({
    signatureId: input.signatureId,
    revoker: {
      iss: revoker.iss,
      sub: revoker.sub,
      name: revoker.name,
      groups: revoker.groups,
    },
    reason: input.reasonText,
    changeControlId,
    commitIds: Array.isArray(body.commitIds) ? body.commitIds.map(String) : undefined,
    mergeRequestId: typeof body.mergeRequestId === 'string' ? body.mergeRequestId : undefined,
  })
  if (!result.ok) {
    await input.audit({
      action: 'esign.revoke_denied',
      status: result.status,
      message: result.detail,
      detail: { code: result.code, signatureId: input.signatureId },
    })
    return json(result.status, { error: result.detail, code: result.code })
  }
  await input.audit({
    action: 'esign.revoked',
    change: requireAuditChange(null, {
      revocation_id: result.revocation.id,
      signature_id: result.revocation.signatureId,
      change_control_id: result.revocation.changeControlId,
      commit_ids: result.revocation.commitIds,
      commit_qc: 'failed',
    }),
    message: `Revoked signature ${result.revocation.signatureId}`,
    detail: {
      signatureId: result.revocation.signatureId,
      revocationId: result.revocation.id,
      commitIds: result.revocation.commitIds,
      blockedMergeRequestIds: result.blockedMergeRequestIds,
      changeControlId,
    },
  })
  return json(200, {
    revocation: result.revocation,
    blockedMergeRequestIds: result.blockedMergeRequestIds,
  })
}

export async function revertSignatureRevocationUseCase(input: {
  user: SessionUser
  signatureId: string
  revocationId: string
  reasonText: string
  changeControlHeader: string | undefined
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<JsonOutcome> {
  const body = input.body as { changeControlId?: string }
  const changeControlId =
    (typeof body.changeControlId === 'string' && body.changeControlId.trim()) ||
    input.changeControlHeader?.trim() ||
    allocateChangeControlId()
  let reverter = input.user
  try {
    reverter = await confirmPrivilegedGroups(input.user)
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
      return json(503, { error: 'Directory unavailable' })
    }
    throw err
  }
  const result = await revertSignatureRevocation({
    signatureId: input.signatureId,
    revocationId: input.revocationId,
    reverter: {
      iss: reverter.iss,
      sub: reverter.sub,
      name: reverter.name,
      groups: reverter.groups,
    },
    reason: input.reasonText,
    changeControlId,
  })
  if (!result.ok) {
    await input.audit({
      action: 'esign.revocation_revert_denied',
      status: result.status,
      message: result.detail,
      detail: {
        code: result.code,
        signatureId: input.signatureId,
        revocationId: input.revocationId,
      },
    })
    return json(result.status, { error: result.detail, code: result.code })
  }
  await input.audit({
    action: 'esign.revocation_reverted',
    change: requireAuditChange(null, {
      revert_id: result.revert.id,
      revocation_id: result.revert.revocationId,
      signature_id: result.revert.signatureId,
      change_control_id: result.revert.changeControlId,
      commit_ids: result.revert.restoredCommitIds,
      commit_qc: 'passed',
    }),
    message: `Reverted revocation ${result.revert.revocationId} on signature ${result.revert.signatureId}`,
    detail: {
      signatureId: result.revert.signatureId,
      revocationId: result.revert.revocationId,
      revertId: result.revert.id,
      restoredCommitIds: result.revert.restoredCommitIds,
      changeControlId,
    },
  })
  return json(200, { revert: result.revert })
}

/** Re-export header constant for route adapter. */
export { CHANGE_CONTROL_HEADER }
