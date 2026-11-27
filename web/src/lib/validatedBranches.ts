import { authzFetch } from './authzApi'
import type { DispositionMap } from './disposition'

export type ValidatedBranchRow = {
  branch: string
  markedAt: string
  markedBy: string | null
  reason: string | null
  changeControlId: string | null
}

export type ValidatedBranchesResponse = {
  defaultBranch: string
  validatedBranches: string[]
  branches: ValidatedBranchRow[]
}

/** List validated branches for a repository (read). */
export function fetchValidatedBranches(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
) {
  return authzFetch<ValidatedBranchesResponse>(
    `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/validated-branches`,
    { signal },
  )
}

/**
 * Mark an existing branch validated. Ceremony (reason + e-signature) via authzFetch.
 * When tip ancestry still has Unset commits, pass an explicit disposition map (ADR 0009).
 */
export function markBranchValidated(
  namespace: string,
  repo: string,
  branch: string,
  opts?: { disposition?: DispositionMap },
) {
  const disposition = opts?.disposition
  return authzFetch<{
    branch: string
    validated: boolean
    validatedBranches: string[]
    changeControlId?: string
    unchanged?: boolean
    blessedCommitIds?: string[]
    signatureId?: string
  }>(
    `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/validated-branches`,
    {
      method: 'POST',
      body: JSON.stringify({
        branch,
        ...(disposition && Object.keys(disposition).length > 0
          ? { disposition }
          : {}),
      }),
    },
  )
}

/**
 * Clear validation for a branch. Ceremony via authzFetch.
 * A repository may end with zero validated branches (allowed; not the create default).
 */
export function unmarkBranchValidated(namespace: string, repo: string, branch: string) {
  return authzFetch<{
    branch: string
    validated: boolean
    validatedBranches: string[]
    changeControlId?: string
    unchanged?: boolean
  }>(
    `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/validated-branches/${encodeURIComponent(branch)}`,
    { method: 'DELETE', body: JSON.stringify({}) },
  )
}
