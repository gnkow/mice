import { decideManageApprovers, readRepository } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import { principalKey } from '../../authentication/principal.js'
import { requireAuditChange } from '../../audit/change.js'
import type { AuditFields } from '../../shared/index.js'
import { allocateChangeControlId, normalizeChangeControlId } from './changeControl.js'
import { json, type JsonOutcome } from './httpOutcome.js'
import {
  listValidatedBranches,
  listValidatedBranchRows,
  markBranchValidated,
  unmarkBranchValidated,
} from './validatedBranchStore.js'
import { MICE_DEFAULT_BRANCH } from './validatedBranchGate.js'

type AuditFn = (fields: AuditFields) => void | Promise<void>

function branchSnapshot(branches: string[]) {
  return { validated_branches: [...branches].sort() }
}

/**
 * Owner mark-validated use-case: step-up + reason + change-control are enforced
 * by `guarded({ reason: true })`; this owns AuthZ, registry write, and audit change.
 */
export async function markBranchValidatedUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  body: Record<string, unknown>
  reasonText: string
  changeControlHeader: string | undefined
  audit: AuditFn
}): Promise<JsonOutcome> {
  const { user, ns, repoName, body, audit } = input
  const ownerGate = await decideManageApprovers(user, ns)
  if (!ownerGate.allow) {
    return json(ownerGate.status ?? 403, { error: ownerGate.reason ?? 'Forbidden' })
  }

  const branch =
    (typeof body.branch === 'string' && body.branch.trim()) ||
    (typeof body.name === 'string' && body.name.trim()) ||
    ''
  if (!branch) return json(400, { error: 'branch required' })

  const repo = await readRepository(ns, repoName)
  if (!repo) return json(404, { error: 'Repository not found' })

  const before = await listValidatedBranches(repo.id, MICE_DEFAULT_BRANCH)
  if (before.includes(branch)) {
    return json(200, {
      branch,
      validated: true,
      validatedBranches: before,
      unchanged: true,
    })
  }

  const fromHeader = normalizeChangeControlId(input.changeControlHeader)
  const fromBody =
    typeof body.changeControlId === 'string' ? body.changeControlId.trim() : ''
  const changeControlId = fromHeader || fromBody || allocateChangeControlId()

  await markBranchValidated({
    repositoryId: repo.id,
    branch,
    markedBy: principalKey(user),
    reason: input.reasonText,
    changeControlId,
  })

  const after = await listValidatedBranches(repo.id, MICE_DEFAULT_BRANCH)
  await audit({
    action: 'validated_branch.mark',
    change: requireAuditChange(branchSnapshot(before), branchSnapshot(after)),
    namespace: ns,
    repo: repoName,
    message: `Marked branch ${branch} as validated`,
    detail: {
      branch,
      repository_id: repo.id,
      change_control_id: changeControlId,
      marked_by: principalKey(user),
    },
  })

  return json(200, {
    branch,
    validated: true,
    validatedBranches: after,
    changeControlId,
  })
}

/**
 * Owner unmark-validated use-case: step-up + reason + change-control are enforced
 * by `guarded({ reason: true })`; this owns AuthZ, registry clear, and audit change.
 * Default branch may be unmarked only through this signed path (#119).
 */
export async function unmarkBranchValidatedUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  branch: string
  body: Record<string, unknown>
  reasonText: string
  changeControlHeader: string | undefined
  audit: AuditFn
}): Promise<JsonOutcome> {
  const { user, ns, repoName, audit } = input
  const ownerGate = await decideManageApprovers(user, ns)
  if (!ownerGate.allow) {
    return json(ownerGate.status ?? 403, { error: ownerGate.reason ?? 'Forbidden' })
  }

  const branch = input.branch.trim()
  if (!branch) return json(400, { error: 'branch required' })

  const repo = await readRepository(ns, repoName)
  if (!repo) return json(404, { error: 'Repository not found' })

  const before = await listValidatedBranches(repo.id, MICE_DEFAULT_BRANCH)
  if (!before.includes(branch)) {
    return json(200, {
      branch,
      validated: false,
      validatedBranches: before,
      unchanged: true,
    })
  }

  const fromHeader = normalizeChangeControlId(input.changeControlHeader)
  const fromBody =
    typeof input.body.changeControlId === 'string' ? input.body.changeControlId.trim() : ''
  const changeControlId = fromHeader || fromBody || allocateChangeControlId()

  await unmarkBranchValidated(repo.id, branch)

  const after = await listValidatedBranches(repo.id, MICE_DEFAULT_BRANCH)
  await audit({
    action: 'validated_branch.unmark',
    change: requireAuditChange(branchSnapshot(before), branchSnapshot(after)),
    namespace: ns,
    repo: repoName,
    message: `Unmarked branch ${branch} as validated`,
    detail: {
      branch,
      repository_id: repo.id,
      change_control_id: changeControlId,
      unmarked_by: principalKey(user),
    },
  })

  return json(200, {
    branch,
    validated: false,
    validatedBranches: after,
    changeControlId,
  })
}

export async function listValidatedBranchesUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
}): Promise<JsonOutcome> {
  const { hasRepoPermission } = await import('../../authz/index.js')
  if (!(await hasRepoPermission(input.user, input.ns, input.repoName, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const repo = await readRepository(input.ns, input.repoName)
  if (!repo) return json(404, { error: 'Repository not found' })
  const validatedBranches = await listValidatedBranches(repo.id, MICE_DEFAULT_BRANCH)
  const rows = await listValidatedBranchRows(repo.id)
  return json(200, {
    defaultBranch: MICE_DEFAULT_BRANCH,
    validatedBranches,
    branches: rows.filter((r) => r.validated).map((r) => ({
      branch: r.branch,
      markedAt: r.markedAt.toISOString(),
      markedBy: r.markedBy,
      reason: r.reason,
      changeControlId: r.changeControlId,
    })),
  })
}
