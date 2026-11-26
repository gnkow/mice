import { datasetTarget } from '../../audit/index.js'
import { isValidatedBranch } from './signedMergeComplete.js'

/**
 * Direct tip-changing writes to a validated branch are forbidden for everyone.
 * Changes reach that branch only through a signed merge request.
 */
export const VALIDATED_BRANCH_DIRECT_WRITE =
  'Validated branch is write-protected: open a merge request and have an Approver sign it'

/** Mutations that add commits or move/delete a branch tip (or land upload onto one). */
const TIP_CHANGING_ACTIONS = new Set([
  'file.write',
  'file.delete',
  'workspace.commit',
  'workspace.merge',
  'merge',
  'branch.delete',
  'branch.update',
  // Oxen push lands via complete; no branch in the path — callers must resolve tip/branch.
  'commit.publish',
  // Chunked upload / versions transport: refuse when the destination branch is known and validated.
  'commit.upload',
])

export function isTipChangingAction(action: string): boolean {
  return TIP_CHANGING_ACTIONS.has(action)
}

export type ValidatedBranchWriteDecision =
  | { allow: true }
  | { allow: false; reason: typeof VALIDATED_BRANCH_DIRECT_WRITE; branch: string }

/**
 * Build the validated set used by the gate.
 * Prefer an explicit `validatedBranches` list from the registry; otherwise the
 * default branch is treated as validated and `markedBranches` are unioned in.
 */
export function resolveValidatedBranchSet(input: {
  validatedBranches?: readonly string[]
  defaultBranch?: string
  markedBranches?: readonly string[]
}): string[] {
  if (input.validatedBranches) {
    return [...input.validatedBranches]
  }
  const defaultBranch = (input.defaultBranch ?? 'main').trim() || 'main'
  const marked = (input.markedBranches ?? []).map((b) => b.trim()).filter(Boolean)
  return [...new Set([defaultBranch, ...marked])]
}

/**
 * Refuse when a mutating oxen action targets a validated branch.
 * Pass `validatedBranches` from the registry when available; otherwise
 * `defaultBranch` (+ optional `markedBranches`) builds the set.
 */
export function decideValidatedBranchWrite(input: {
  action: string
  branch?: string | null
  /** Branches to evaluate (publish may move more than one tip). */
  branches?: readonly string[]
  validatedBranches?: readonly string[]
  defaultBranch?: string
  markedBranches?: readonly string[]
}): ValidatedBranchWriteDecision {
  if (!TIP_CHANGING_ACTIONS.has(input.action)) return { allow: true }
  const targets = (
    input.branches?.length
      ? input.branches
      : input.branch
        ? [input.branch]
        : []
  )
    .map((b) => b.trim())
    .filter(Boolean)
  if (!targets.length) return { allow: true }

  const validated = resolveValidatedBranchSet(input)
  for (const branch of targets) {
    if (isValidatedBranch(branch, validated)) {
      return { allow: false, reason: VALIDATED_BRANCH_DIRECT_WRITE, branch }
    }
  }
  return { allow: true }
}

/** Resolve the branch tip a proxied path would change, when known from the URL. */
export function branchTargetFromPath(pathname: string): string | undefined {
  return datasetTarget(pathname).branch
}

/** Pull a branch name from a proxied JSON body when the path has none. */
export function branchFromMutationBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const o = body as Record<string, unknown>
  for (const key of ['branch', 'branch_name', 'new_branch', 'ref'] as const) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/**
 * Branches whose tips would move when `publishedCommit` lands, given live tips
 * and the commit's parents (parent tip match).
 */
export function branchesMovedByPublish(input: {
  publishedCommit: string
  parents: readonly string[]
  branchTips: ReadonlyArray<{ name: string; commit_id: string }>
}): string[] {
  const parents = new Set(input.parents.map((p) => p.trim()).filter(Boolean))
  if (!parents.size) return []
  const moved: string[] = []
  for (const tip of input.branchTips) {
    const id = tip.commit_id?.trim()
    if (id && parents.has(id)) moved.push(tip.name)
  }
  return moved
}

/**
 * Template install must not unsigned-seed onto a validated tip — open an MR into
 * the empty default instead. Use-case product comes later; this is the refuse seam.
 */
export function decideUnsignedTemplateSeed(input: {
  targetBranch: string
  validatedBranches: readonly string[]
}): ValidatedBranchWriteDecision {
  const gate = decideValidatedBranchWrite({
    action: 'file.write',
    branch: input.targetBranch,
    validatedBranches: input.validatedBranches,
  })
  if (!gate.allow) {
    return {
      allow: false,
      reason: VALIDATED_BRANCH_DIRECT_WRITE,
      branch: gate.branch,
    }
  }
  return { allow: true }
}
