import { and, eq } from 'drizzle-orm'
import { getDb } from '../../../db/database.js'
import { validatedBranches } from '../../../db/schema.js'

export type ValidatedBranchRow = {
  repositoryId: string
  branch: string
  validated: boolean
  markedAt: Date
  markedBy: string | null
  reason: string | null
  changeControlId: string | null
}

/**
 * Branches currently in the validated set.
 * Empty registry (pre-seed) materializes the default once. Rows with
 * `validated=false` (signed unmark, #119) stay out of the set and block rematerialize.
 */
export async function listValidatedBranches(
  repositoryId: string,
  defaultBranch = 'main',
): Promise<string[]> {
  const rows = await getDb()
    .select({ branch: validatedBranches.branch, validated: validatedBranches.validated })
    .from(validatedBranches)
    .where(eq(validatedBranches.repositoryId, repositoryId))
  if (rows.length === 0) {
    await ensureDefaultBranchValidated(repositoryId, defaultBranch)
    return [defaultBranch.trim() || 'main']
  }
  return rows.filter((r) => r.validated).map((r) => r.branch)
}

export async function listValidatedBranchRows(
  repositoryId: string,
): Promise<ValidatedBranchRow[]> {
  const rows = await getDb()
    .select()
    .from(validatedBranches)
    .where(eq(validatedBranches.repositoryId, repositoryId))
  return rows.map((r) => ({
    repositoryId: r.repositoryId,
    branch: r.branch,
    validated: r.validated,
    markedAt: r.markedAt,
    markedBy: r.markedBy ?? null,
    reason: r.reason ?? null,
    changeControlId: r.changeControlId ?? null,
  }))
}

/**
 * Seed the default branch as validated (repo create / empty-default bootstrap).
 * Idempotent — does not revive a branch cleared by unmark (`validated=false`).
 */
export async function ensureDefaultBranchValidated(
  repositoryId: string,
  defaultBranch = 'main',
): Promise<void> {
  const branch = defaultBranch.trim() || 'main'
  await getDb()
    .insert(validatedBranches)
    .values({
      repositoryId,
      branch,
      validated: true,
      markedAt: new Date(),
      markedBy: null,
      reason: null,
      changeControlId: null,
    })
    .onConflictDoNothing()
}

/**
 * Owner mark: add (or re-validate) a branch in the validated set.
 */
export async function markBranchValidated(input: {
  repositoryId: string
  branch: string
  markedBy: string
  reason: string
  changeControlId: string
}): Promise<void> {
  const branch = input.branch.trim()
  if (!branch) throw new Error('branch name required')
  const now = new Date()
  await getDb()
    .insert(validatedBranches)
    .values({
      repositoryId: input.repositoryId,
      branch,
      validated: true,
      markedAt: now,
      markedBy: input.markedBy,
      reason: input.reason,
      changeControlId: input.changeControlId,
    })
    .onConflictDoUpdate({
      target: [validatedBranches.repositoryId, validatedBranches.branch],
      set: {
        validated: true,
        markedAt: now,
        markedBy: input.markedBy,
        reason: input.reason,
        changeControlId: input.changeControlId,
      },
    })
}

/**
 * Clear validation for a branch (#119 ceremony wraps this).
 * Keeps the row with `validated=false` so listValidatedBranches does not rematerialize.
 */
export async function unmarkBranchValidated(
  repositoryId: string,
  branch: string,
): Promise<boolean> {
  const name = branch.trim()
  if (!name) return false
  const now = new Date()
  const updated = await getDb()
    .update(validatedBranches)
    .set({ validated: false, markedAt: now })
    .where(
      and(
        eq(validatedBranches.repositoryId, repositoryId),
        eq(validatedBranches.branch, name),
        eq(validatedBranches.validated, true),
      ),
    )
    .returning({ branch: validatedBranches.branch })
  if (updated.length > 0) return true
  // Ensure a cleared row exists so lazy seed cannot revive the branch.
  await getDb()
    .insert(validatedBranches)
    .values({
      repositoryId,
      branch: name,
      validated: false,
      markedAt: now,
      markedBy: null,
      reason: null,
      changeControlId: null,
    })
    .onConflictDoUpdate({
      target: [validatedBranches.repositoryId, validatedBranches.branch],
      set: { validated: false, markedAt: now },
    })
  return true
}
