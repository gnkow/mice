import {
  decideIsApprover,
  decideManageRepoCollaborators,
  readRepository,
} from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import { principalKey } from '../../authentication/principal.js'
import { requireAuditChange } from '../../audit/change.js'
import type { AuditFields } from '../../shared/index.js'
import { allocateChangeControlId, normalizeChangeControlId } from './changeControl.js'
import {
  applyDispositionMap,
  getCommitQc,
  parseDispositionMap,
} from './commitQcStore.js'
import { json, type JsonOutcome } from './httpOutcome.js'
import {
  listValidatedBranches,
  listValidatedBranchRows,
  markBranchValidated,
  unmarkBranchValidated,
} from './validatedBranchStore.js'
import { MICE_DEFAULT_BRANCH } from './validatedBranchGate.js'

type AuditFn = (fields: AuditFields) => void | Promise<void>

export type TipCommit = {
  id: string
  author: string
  parentIds: string[]
}

export type UnsignedTipHistory = {
  tip: string | null
  commits: TipCommit[]
  /** Tip has parents and at least one Unset commit in the walk. */
  requiresApprover: boolean
}

type TipHistoryResolver = (input: {
  ns: string
  repoName: string
  repositoryId: string
  branch: string
}) => Promise<UnsignedTipHistory>

let tipHistoryResolverForTests: TipHistoryResolver | null = null

/** Test seam: replace oxen tip ancestry walk. */
export function setTipHistoryResolverForTests(next: TipHistoryResolver | null): void {
  tipHistoryResolverForTests = next
}

function branchSnapshot(branches: string[]) {
  return { validated_branches: [...branches].sort() }
}

async function fetchOxenCommit(
  physicalNs: string,
  physicalRepo: string,
  commitId: string,
): Promise<TipCommit | null> {
  const { env } = await import('../../shared/index.js')
  const res = await fetch(
    `${env.oxenUpstream}/api/repos/${encodeURIComponent(physicalNs)}/${encodeURIComponent(physicalRepo)}/commits/${encodeURIComponent(commitId)}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    return null
  }
  const body = (await res.json()) as {
    commit?: {
      id?: string
      author?: string
      parent_ids?: string[]
      parents?: string[]
    }
    id?: string
    author?: string
    parent_ids?: string[]
  }
  const id = (body.commit?.id ?? body.id ?? commitId).trim()
  const author =
    (typeof body.commit?.author === 'string' && body.commit.author.trim()) ||
    (typeof body.author === 'string' && body.author.trim()) ||
    ''
  const parents = body.commit?.parent_ids ?? body.commit?.parents ?? body.parent_ids ?? []
  return {
    id,
    author,
    parentIds: parents.filter((p): p is string => typeof p === 'string' && Boolean(p.trim())),
  }
}

/**
 * Walk tip ancestry collecting Unset commits (ADR 0009). Valid/Invalid are
 * already dispositioned; continue through them so deeper Unset ancestors surface.
 */
export async function listUnsignedTipHistory(
  ns: string,
  repoName: string,
  repositoryId: string,
  branch: string,
): Promise<UnsignedTipHistory> {
  if (tipHistoryResolverForTests) {
    return tipHistoryResolverForTests({ ns, repoName, repositoryId, branch })
  }
  try {
    const { getBranchTip } = await import('../../jobs/index.js')
    const tip = (await getBranchTip(ns, repoName, branch))?.trim() || null
    if (!tip) return { tip: null, commits: [], requiresApprover: false }

    const { resolvePhysicalRepo } = await import('../../namespaces/index.js')
    const physical = await resolvePhysicalRepo(ns, repoName)
    if (!physical) {
      // Fail closed: treat as Unset tip that needs Approver.
      return {
        tip,
        commits: [{ id: tip, author: '', parentIds: ['unknown'] }],
        requiresApprover: true,
      }
    }

    const commits: TipCommit[] = []
    const seen = new Set<string>()
    const queue = [tip]
    let tipParents: string[] | null = null

    while (queue.length > 0) {
      const id = queue.shift()!
      if (seen.has(id)) continue
      seen.add(id)

      const qc = await getCommitQc(repositoryId, id)
      const row = await fetchOxenCommit(physical.namespaceId, physical.repositoryId, id)
      if (!row) {
        if (qc === 'unset') {
          commits.push({ id, author: '', parentIds: id === tip ? ['unknown'] : [] })
        }
        if (id === tip) tipParents = ['unknown']
        continue
      }
      if (id === tip) tipParents = row.parentIds
      if (qc === 'unset') commits.push(row)
      for (const parent of row.parentIds) {
        if (!seen.has(parent)) queue.push(parent)
      }
    }

    const requiresApprover =
      commits.length > 0 && (tipParents === null || tipParents.length > 0)
    return { tip, commits, requiresApprover }
  } catch {
    return {
      tip: null,
      commits: [{ id: 'unknown', author: '', parentIds: ['unknown'] }],
      requiresApprover: true,
    }
  }
}

/**
 * True when marking this tip would place Unset history on a validated branch.
 * Root/bootstrap tips (no parents) and missing tips do not require Approver.
 */
export async function markRequiresApprover(
  ns: string,
  repoName: string,
  repositoryId: string,
  branch: string,
): Promise<boolean> {
  return (await listUnsignedTipHistory(ns, repoName, repositoryId, branch)).requiresApprover
}

/**
 * Mark-validated use-case: namespace Owner or repo maintain/admin (manager).
 * When Unset tip-ancestry commits remain, Approver is required and must submit
 * an explicit disposition map (no silent all-Valid). Self-Valid is refused.
 * Step-up + reason + change-control via `guarded({ reason: true })`.
 */
export async function markBranchValidatedUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  body: Record<string, unknown>
  reasonText: string
  changeControlHeader: string | undefined
  signatureId?: string
  audit: AuditFn
}): Promise<JsonOutcome> {
  const { user, ns, repoName, body, audit } = input
  const gate = await decideManageRepoCollaborators(user, ns, repoName)
  if (!gate.allow) {
    return json(gate.status ?? 403, { error: gate.reason ?? 'Forbidden' })
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

  const unsetHistory = await listUnsignedTipHistory(ns, repoName, repo.id, branch)
  const unsetCommits = unsetHistory.commits.filter((c) => c.id && c.id !== 'unknown')
  if (unsetHistory.requiresApprover) {
    const approver = await decideIsApprover(user, ns, repoName)
    if (!approver.allow) {
      return json(403, {
        error: approver.reason ?? 'Approver role required',
        code: 'approver_required',
      })
    }
  }

  const signatureId = input.signatureId?.trim() || ''
  if (unsetCommits.length > 0 && !signatureId) {
    return json(400, {
      error: 'An electronic signature is required to disposition Unset tip commits',
      code: 'signature_required',
    })
  }

  let dispositionMap = parseDispositionMap(body.disposition ?? body.dispositionMap ?? {})
  if (dispositionMap === null) {
    return json(400, {
      error: 'disposition map must be { commitId: "valid"|"invalid" }',
      code: 'disposition_invalid',
    })
  }
  if (unsetCommits.length > 0) {
    const missing = unsetCommits
      .map((c) => c.id)
      .filter((id) => dispositionMap![id] !== 'valid' && dispositionMap![id] !== 'invalid')
    if (missing.length > 0) {
      return json(400, {
        error: 'Disposition map must cover every Unset tip-ancestry commit',
        code: 'disposition_required',
        commitIds: missing,
      })
    }
    // Only apply entries for the Unset tip commits (ignore extras).
    dispositionMap = Object.fromEntries(
      unsetCommits.map((c) => [c.id, dispositionMap![c.id]!]),
    )
  } else {
    dispositionMap = {}
  }

  const fromHeader = normalizeChangeControlId(input.changeControlHeader)
  const fromBody =
    typeof body.changeControlId === 'string' ? body.changeControlId.trim() : ''
  const changeControlId = fromHeader || fromBody || allocateChangeControlId()

  if (unsetCommits.length > 0 && signatureId) {
    const authorsByCommitId = Object.fromEntries(
      unsetCommits.map((c) => [c.id, c.author.trim() ? [c.author.trim()] : []]),
    )
    const applied = await applyDispositionMap({
      repositoryId: repo.id,
      map: dispositionMap,
      signatureId,
      actor: user,
      authorsByCommitId,
    })
    if (!applied.ok) {
      return json(applied.status, {
        error: applied.detail,
        code: applied.code,
        ...(applied.commitIds ? { commitIds: applied.commitIds } : {}),
      })
    }
  }

  await markBranchValidated({
    repositoryId: repo.id,
    branch,
    markedBy: principalKey(user),
    reason: input.reasonText,
    changeControlId,
  })

  const dispositionedIds = Object.keys(dispositionMap)
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
      ...(signatureId ? { signature_id: signatureId } : {}),
      ...(dispositionedIds.length
        ? { disposition_commit_ids: dispositionedIds, disposition: dispositionMap }
        : {}),
    },
  })

  return json(200, {
    branch,
    validated: true,
    validatedBranches: after,
    changeControlId,
    ...(dispositionedIds.length
      ? {
          dispositionCommitIds: dispositionedIds,
          disposition: dispositionMap,
          signatureId,
          // Back-compat for older clients/tests.
          blessedCommitIds: dispositionedIds,
        }
      : {}),
  })
}

/**
 * Invalidate (unmark) use-case: namespace Owner or repo maintain/admin (manager).
 * Step-up + reason + change-control via `guarded({ reason: true })`.
 * Default branch may be invalidated only through this signed path (#119).
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
  const gate = await decideManageRepoCollaborators(user, ns, repoName)
  if (!gate.allow) {
    return json(gate.status ?? 403, { error: gate.reason ?? 'Forbidden' })
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
  const { decideManageRepoCollaborators, hasRepoPermission } = await import(
    '../../authz/index.js'
  )
  // Readers see the registry; Owners/managers may list even without a collaborator seat.
  const canRead = (await hasRepoPermission(input.user, input.ns, input.repoName, 'read')).ok
  const canManage = (await decideManageRepoCollaborators(input.user, input.ns, input.repoName))
    .allow
  if (!canRead && !canManage) {
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
