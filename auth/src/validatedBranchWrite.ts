import { datasetTarget } from './auditDataset.js'
import { isValidatedBranch } from './signedMergeComplete.js'

/**
 * Direct tip-changing writes to the validated default branch are forbidden for
 * everyone. Changes reach that branch only through a signed merge request.
 */
export const VALIDATED_BRANCH_DIRECT_WRITE =
  'Validated branch is write-protected: open a merge request and have an Approver sign it'

/** Mutations that add commits or move/delete the validated branch tip. */
const TIP_CHANGING_ACTIONS = new Set([
  'file.write',
  'file.delete',
  'workspace.commit',
  'workspace.merge',
  'merge',
  'branch.delete',
  'branch.update',
])

export type ValidatedBranchWriteDecision =
  | { allow: true }
  | { allow: false; reason: typeof VALIDATED_BRANCH_DIRECT_WRITE; branch: string }

/**
 * Refuse when a mutating oxen action targets the validated branch (default: main).
 */
export function decideValidatedBranchWrite(input: {
  action: string
  branch?: string | null
  defaultBranch?: string
}): ValidatedBranchWriteDecision {
  if (!TIP_CHANGING_ACTIONS.has(input.action)) return { allow: true }
  const branch = input.branch?.trim()
  if (!branch) return { allow: true }
  const defaultBranch = input.defaultBranch ?? 'main'
  if (!isValidatedBranch(branch, defaultBranch)) return { allow: true }
  return { allow: false, reason: VALIDATED_BRANCH_DIRECT_WRITE, branch }
}

/** Resolve the branch tip a proxied path would change, when known from the URL. */
export function branchTargetFromPath(pathname: string): string | undefined {
  return datasetTarget(pathname).branch
}
