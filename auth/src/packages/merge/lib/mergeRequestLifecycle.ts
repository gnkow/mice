import { confirmPrivilegedGroups } from '../../authentication/access.js'
import { hasRepoPermission } from '../../authz/index.js'
import { readRepository } from '../../authz/index.js'
import { decideIsApprover } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { AuditFields } from '../../shared/index.js'
import { requireAuditChange } from '../../audit/change.js'
import {
  cancelMergeRequest,
  getMergeRequest,
  listMergeRequests,
  MergeRequestAlreadyOpenError,
  openMergeRequest,
  rejectMergeRequest,
  reopenMergeRequest,
} from './mergeRequestStore.js'
import { resyncMergeRequest } from './mergeRequestTipSync.js'
import { unmarkCommitsForMergeRequest } from './commitQcStore.js'
import { liveTipsFor } from './mergeRequestOxen.js'
import { captureMrSnapshot, mrSnapshot, publicMergeRequest, reconcileOne } from './mergeRequestView.js'
import { json, type JsonOutcome } from './httpOutcome.js'

type AuditFn = (fields: AuditFields) => void | Promise<void>

export async function openMergeRequestUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<JsonOutcome> {
  const { user, ns, repoName, audit } = input
  if (!(await hasRepoPermission(user, ns, repoName, 'write')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const repo = await readRepository(ns, repoName)
  if (!repo) return json(404, { error: 'Not found' })
  const body = input.body as {
    sourceBranch?: string
    targetBranch?: string
    expectedSourceHead?: string
    expectedTargetHead?: string
    title?: string
    description?: string
  }
  if (
    !body.sourceBranch?.trim() ||
    !body.targetBranch?.trim() ||
    !body.expectedSourceHead?.trim() ||
    !body.expectedTargetHead?.trim()
  ) {
    return json(400, { error: 'sourceBranch, targetBranch, and expected heads required' })
  }
  let mr
  try {
    mr = await openMergeRequest({
      repositoryId: repo.id,
      namespace: ns,
      repo: repoName,
      sourceBranch: body.sourceBranch.trim(),
      targetBranch: body.targetBranch.trim(),
      expectedSourceHead: body.expectedSourceHead.trim(),
      expectedTargetHead: body.expectedTargetHead.trim(),
      openedBy: { iss: user.iss, sub: user.sub },
      title: typeof body.title === 'string' ? body.title : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
    })
  } catch (err) {
    if (err instanceof MergeRequestAlreadyOpenError) {
      return json(409, {
        error: err.message,
        code: err.code,
        mergeRequestId: err.existingId,
      })
    }
    throw err
  }
  // ADR 0009: open MR must not write QC (no Marked state).
  await audit({
    action: 'merge_request.open',
    change: requireAuditChange(null, mrSnapshot(mr)),
    message: `Opened MR ${mr.id} ${body.sourceBranch}→${body.targetBranch}`,
    namespace: ns,
    repo: repoName,
    detail: { mergeRequestId: mr.id, repositoryId: repo.id },
  })
  return json(201, { mergeRequest: mr })
}

export async function listMergeRequestsUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
}): Promise<JsonOutcome> {
  const { user, ns, repoName } = input
  if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const repo = await readRepository(ns, repoName)
  if (!repo) return json(404, { error: 'Not found' })
  const rows = await listMergeRequests(repo.id)
  const hasMerged = rows.some((mr) => mr.status === 'merged')
  let revokedIds: Set<string> | undefined
  if (hasMerged) {
    const { signatureStore } = await import('../../authentication/signing.js')
    revokedIds = await (await signatureStore()).listRevokedSignatureIds()
  }
  const mergeRequests = await Promise.all(
    rows.map(async (mr) => publicMergeRequest(await reconcileOne(mr), revokedIds)),
  )
  return json(200, { mergeRequests })
}

export async function getMergeRequestUseCase(input: {
  user: SessionUser
  id: string
}): Promise<JsonOutcome> {
  const mr = await getMergeRequest(input.id)
  if (!mr) return json(404, { error: 'Not found' })
  if (!(await hasRepoPermission(input.user, mr.namespace, mr.repo, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  return json(200, {
    mergeRequest: await publicMergeRequest(await reconcileOne(mr)),
  })
}

export async function resyncMergeRequestUseCase(input: {
  user: SessionUser
  id: string
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<JsonOutcome> {
  const mr = await getMergeRequest(input.id)
  if (!mr) return json(404, { error: 'Not found' })
  if (!(await hasRepoPermission(input.user, mr.namespace, mr.repo, 'write')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const body = input.body as {
    liveSourceHead?: string
    liveTargetHead?: string
    refreshExpected?: boolean
  }
  const refreshExpected = body.refreshExpected === true
  let liveSourceHead = body.liveSourceHead?.trim() ?? ''
  let liveTargetHead = body.liveTargetHead?.trim() ?? ''
  if ((!liveSourceHead || !liveTargetHead) && refreshExpected) {
    const tips = await liveTipsFor(mr)
    if (!tips) {
      return json(503, { error: 'Could not resolve live branch tips', code: 'tips_unavailable' })
    }
    liveSourceHead = tips.sourceHead
    liveTargetHead = tips.targetHead
  }
  if (!liveSourceHead || !liveTargetHead) {
    return json(400, { error: 'liveSourceHead and liveTargetHead required' })
  }
  const beforeResync = await captureMrSnapshot(mr.id)
  const next = await resyncMergeRequest(mr.id, {
    liveSourceHead,
    liveTargetHead,
    refreshExpected,
  })
  await input.audit({
    action: 'merge_request.resync',
    change: requireAuditChange(beforeResync, mrSnapshot(next)),
    message: `Resynced MR ${mr.id} → ${next.status}`,
    namespace: mr.namespace,
    repo: mr.repo,
    detail: {
      mergeRequestId: mr.id,
      status: next.status,
      refreshExpected,
    },
  })
  return json(200, { mergeRequest: next })
}

export async function cancelMergeRequestUseCase(input: {
  user: SessionUser
  id: string
  audit: AuditFn
}): Promise<JsonOutcome> {
  const mr = await getMergeRequest(input.id)
  if (!mr) return json(404, { error: 'Not found' })
  if (!(await hasRepoPermission(input.user, mr.namespace, mr.repo, 'write')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const beforeCancel = await captureMrSnapshot(mr.id)
  const result = await cancelMergeRequest(mr.id)
  if (!result.ok) {
    if (result.code === 'not_found') return json(404, { error: 'Not found' })
    return json(400, {
      error: 'Merge request cannot be cancelled',
      code: 'not_cancellable',
    })
  }
  const unmarkedCommitIds = await unmarkCommitsForMergeRequest(mr.repositoryId, mr.id)
  await input.audit({
    action: 'merge_request.cancel',
    change: requireAuditChange(beforeCancel, mrSnapshot(result.mergeRequest)),
    message: `Cancelled MR ${mr.id} ${mr.sourceBranch}→${mr.targetBranch}`,
    namespace: mr.namespace,
    repo: mr.repo,
    detail: {
      mergeRequestId: mr.id,
      status: result.mergeRequest.status,
      unmarkedCommitIds,
    },
  })
  return json(200, { mergeRequest: result.mergeRequest })
}

export async function reopenMergeRequestUseCase(input: {
  user: SessionUser
  id: string
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<JsonOutcome> {
  const mr = await getMergeRequest(input.id)
  if (!mr) return json(404, { error: 'Not found' })
  if (mr.status === 'cancelled') {
    if (!(await hasRepoPermission(input.user, mr.namespace, mr.repo, 'write')).ok) {
      return json(403, { error: 'Forbidden' })
    }
  } else if (mr.status === 'rejected') {
    let actor = input.user
    try {
      actor = await confirmPrivilegedGroups(input.user)
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
        return json(503, { error: 'Directory unavailable' })
      }
      throw err
    }
    const approver = await decideIsApprover(actor, mr.namespace, mr.repo)
    if (!approver.allow) {
      await input.audit({
        action: 'merge_request.reopen_denied',
        status: 403,
        message: approver.reason ?? 'Approver role required',
        detail: { mergeRequestId: mr.id, code: 'not_approver', fromStatus: 'rejected' },
      })
      return json(403, {
        error: approver.reason ?? 'Approver role required',
        code: 'not_approver',
      })
    }
  } else {
    return json(400, {
      error: 'Merge request cannot be reopened',
      code: 'not_reopenable',
    })
  }
  const body = input.body as {
    liveSourceHead?: string
    liveTargetHead?: string
    refreshExpected?: boolean
  }
  const refreshExpected = body.refreshExpected !== false
  let liveSourceHead = body.liveSourceHead?.trim() ?? ''
  let liveTargetHead = body.liveTargetHead?.trim() ?? ''
  if ((!liveSourceHead || !liveTargetHead) && refreshExpected) {
    const tips = await liveTipsFor(mr)
    if (tips) {
      liveSourceHead = tips.sourceHead
      liveTargetHead = tips.targetHead
    }
  }
  const beforeReopen = await captureMrSnapshot(mr.id)
  const result = await reopenMergeRequest(mr.id, {
    liveSourceHead: liveSourceHead || undefined,
    liveTargetHead: liveTargetHead || undefined,
    refreshExpected: Boolean(liveSourceHead && liveTargetHead && refreshExpected),
  })
  if (!result.ok) {
    if (result.code === 'not_found') return json(404, { error: 'Not found' })
    if (result.code === 'already_open') {
      return json(409, {
        error:
          'A merge request for this source and target branch already exists. Open, reopen, or revert that request instead of creating another.',
        code: 'already_open',
        existingId: result.existingId,
      })
    }
    return json(400, {
      error: 'Merge request cannot be reopened',
      code: 'not_reopenable',
    })
  }
  const fromStatus = mr.status
  await input.audit({
    action:
      fromStatus === 'rejected' ? 'merge_request.reject_reverted' : 'merge_request.reopen',
    change: requireAuditChange(beforeReopen, mrSnapshot(result.mergeRequest)),
    message:
      fromStatus === 'rejected'
        ? `Reverted reject on MR ${mr.id} ${mr.sourceBranch}→${mr.targetBranch}`
        : `Reopened MR ${mr.id} ${mr.sourceBranch}→${mr.targetBranch}`,
    namespace: mr.namespace,
    repo: mr.repo,
    detail: {
      mergeRequestId: mr.id,
      fromStatus,
      status: result.mergeRequest.status,
    },
  })
  return json(200, { mergeRequest: result.mergeRequest })
}

export async function rejectMergeRequestUseCase(input: {
  user: SessionUser
  id: string
  audit: AuditFn
}): Promise<JsonOutcome> {
  const mr = await getMergeRequest(input.id)
  if (!mr) return json(404, { error: 'Not found' })
  let actor = input.user
  try {
    actor = await confirmPrivilegedGroups(input.user)
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
      return json(503, { error: 'Directory unavailable' })
    }
    throw err
  }
  const approver = await decideIsApprover(actor, mr.namespace, mr.repo)
  if (!approver.allow) {
    await input.audit({
      action: 'merge_request.reject_denied',
      status: 403,
      message: approver.reason ?? 'Approver role required',
      detail: { mergeRequestId: mr.id, code: 'not_approver' },
    })
    return json(403, { error: approver.reason ?? 'Approver role required', code: 'not_approver' })
  }
  const beforeReject = await captureMrSnapshot(mr.id)
  const result = await rejectMergeRequest(mr.id)
  if (!result.ok) {
    if (result.code === 'not_found') return json(404, { error: 'Not found' })
    return json(400, {
      error: 'Merge request cannot be rejected',
      code: 'not_rejectable',
    })
  }
  const unmarkedCommitIds = await unmarkCommitsForMergeRequest(mr.repositoryId, mr.id)
  await input.audit({
    action: 'merge_request.reject',
    change: requireAuditChange(beforeReject, mrSnapshot(result.mergeRequest)),
    message: `Rejected MR ${mr.id} ${mr.sourceBranch}→${mr.targetBranch}`,
    namespace: mr.namespace,
    repo: mr.repo,
    detail: {
      mergeRequestId: mr.id,
      status: result.mergeRequest.status,
      unmarkedCommitIds,
    },
  })
  return json(200, { mergeRequest: result.mergeRequest })
}
