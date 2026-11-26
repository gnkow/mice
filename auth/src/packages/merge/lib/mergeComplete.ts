import { confirmPrivilegedGroups } from '../../authentication/access.js'
import { hasRepoPermission } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { AuditFields } from '../../shared/index.js'
import { requireAuditChange } from '../../audit/change.js'
import { completeSignedMerge } from './completeSignedMerge.js'
import { getMergeRequest } from './mergeRequestStore.js'
import {
  defaultExecuteMerge,
  getLiveHeadsResolver,
  getMergeExecutor,
  getMergeManifestResolver,
  getMergeRangeResolver,
} from './mergeRequestOxen.js'
import { captureMrSnapshot, mrSnapshot, reconcileOne } from './mergeRequestView.js'
import { signerAuthorKey } from './selfMerge.js'
import { json, type JsonOutcome } from './httpOutcome.js'

type AuditFn = (fields: AuditFields) => void | Promise<void>

export async function signingPreviewUseCase(input: {
  user: SessionUser
  id: string
}): Promise<JsonOutcome> {
  const loaded = await getMergeRequest(input.id)
  if (!loaded) return json(404, { error: 'Not found' })
  if (!(await hasRepoPermission(input.user, loaded.namespace, loaded.repo, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  // Same live-tip reconcile as list/get so Outdated appears before Approve (#158).
  const mr = await reconcileOne(loaded)
  const { mergeResultBinding, manifestForMergeResult } = await import('../../authentication/signing.js')
  const { isValidatedBranch } = await import('./signedMergeComplete.js')
  const { listValidatedBranches } = await import('./validatedBranchStore.js')
  const mergeManifestResolver = getMergeManifestResolver()
  let merge
  try {
    merge = mergeManifestResolver
      ? await mergeManifestResolver({
          namespace: mr.namespace,
          repo: mr.repo,
          sourceHead: mr.expectedSourceHead,
          targetHead: mr.expectedTargetHead,
        })
      : await manifestForMergeResult(
          { namespace: mr.namespace, repo: mr.repo },
          mr.expectedSourceHead,
          mr.expectedTargetHead,
        )
  } catch (err) {
    return json(503, {
      error: 'Merge-result manifest unavailable',
      code: 'manifest_unavailable',
      detail: String((err as Error)?.message ?? err),
    })
  }
  const manifestEntries = merge.manifest
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const sp = line.lastIndexOf(' ')
      return {
        path: line.slice(0, sp),
        contentHash: line.slice(sp + 1),
      }
    })
  const { binding, manifest } = mergeResultBinding({
    repo: `${mr.namespace}/${mr.repo}`,
    sourceHead: mr.expectedSourceHead,
    targetHead: mr.expectedTargetHead,
    merge,
  })
  return json(200, {
    mergeRequest: mr,
    meaning: 'Approved',
    content: manifest,
    hash: binding.manifestDigest,
    binding,
    manifest,
    manifestEntries,
    validatedTarget: isValidatedBranch(
      mr.targetBranch,
      await listValidatedBranches(mr.repositoryId),
    ),
    principal: {
      iss: input.user.iss,
      sub: input.user.sub,
      name: input.user.name ?? `${input.user.iss}|${input.user.sub}`,
    },
  })
}

export async function completeMergeRequestUseCase(input: {
  user: SessionUser
  id: string
  reasonHeader: string | undefined
  signatureHeader: string | undefined
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<JsonOutcome> {
  const { resolveReason } = await import('../../audit/index.js')
  const reason = resolveReason({
    actor: input.user,
    explicit: input.reasonHeader,
  })
  if (!reason.ok) {
    return json(400, { error: reason.rejection.detail, code: reason.rejection.code })
  }
  const body = input.body as { signatureId?: string }
  const signatureId =
    (typeof body.signatureId === 'string' && body.signatureId.trim()) ||
    input.signatureHeader?.trim() ||
    ''
  if (!signatureId) {
    await input.audit({
      action: 'merge_request.complete_denied',
      status: 400,
      message: 'signature id required',
      detail: {
        code: 'signature_invalid',
        mergeRequestId: input.id,
        reason: reason.value.reason,
      },
    })
    return json(400, {
      error: 'signature id required',
      code: 'signature_invalid',
    })
  }
  let signer = input.user
  try {
    signer = await confirmPrivilegedGroups(input.user)
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
      return json(503, { error: 'Directory unavailable' })
    }
    throw err
  }
  const beforeComplete = await captureMrSnapshot(input.id)
  const mergeManifestResolver = getMergeManifestResolver()
  const liveHeadsResolver = getLiveHeadsResolver()
  const mergeRangeResolver = getMergeRangeResolver()
  let result
  try {
    result = await completeSignedMerge({
      mergeRequestId: input.id,
      signer: {
        iss: signer.iss,
        sub: signer.sub,
        name: signer.name,
        groups: signer.groups,
      },
      signatureId,
      ...(mergeManifestResolver ? { resolveMergeManifest: mergeManifestResolver } : {}),
      ...(liveHeadsResolver ? { resolveLiveHeads: liveHeadsResolver } : {}),
      ...(mergeRangeResolver ? { resolveMergeRange: mergeRangeResolver } : {}),
      executeMerge: getMergeExecutor() ?? defaultExecuteMerge,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Signed merge failed'
    await input.audit({
      action: 'merge_request.complete_denied',
      status: 502,
      message: detail,
      detail: { mergeRequestId: input.id, reason: reason.value.reason },
    })
    return json(502, { error: detail, code: 'merge_failed' })
  }
  if (!result.ok) {
    await input.audit({
      action: 'merge_request.complete_denied',
      status: result.status,
      message: result.detail,
      detail: {
        code: result.code,
        mergeRequestId: input.id,
        reason: reason.value.reason,
        signatureId,
        ...(result.signatureConsumed ? { signatureConsumed: true } : {}),
        ...(result.authors ? { authors: result.authors, signer: signerAuthorKey(signer) } : {}),
      },
    })
    return json(result.status, { error: result.detail, code: result.code })
  }
  const { signatureStore } = await import('../../authentication/signing.js')
  const { mutationSignatureAuditDetail } = await import('../../authentication/signing.js')
  const storedSig = await (await signatureStore()).get(result.signatureId)
  const ceremonyDetail = storedSig
    ? mutationSignatureAuditDetail(result.signatureId, storedSig.record)
    : { signatureId: result.signatureId }
  const changeControlId =
    (storedSig?.record.changeControlId && String(storedSig.record.changeControlId).trim()) ||
    undefined
  await input.audit({
    action: 'merge_request.complete',
    change: requireAuditChange(beforeComplete, {
      ...mrSnapshot(result.mergeRequest),
      mergeCommitId: result.mergeCommitId,
    }),
    message: `Signed merge completed ${result.mergeRequest.id}`,
    namespace: result.mergeRequest.namespace,
    repo: result.mergeRequest.repo,
    signature_id: result.signatureId,
    reason: reason.value.reason,
    reason_source: reason.value.reason_source,
    ...(changeControlId ? { change_control_id: changeControlId } : {}),
    detail: {
      mergeRequestId: result.mergeRequest.id,
      mergeCommitId: result.mergeCommitId,
      ...ceremonyDetail,
    },
  })
  return json(200, {
    mergeRequest: result.mergeRequest,
    mergeCommitId: result.mergeCommitId,
    signatureId: result.signatureId,
  })
}
