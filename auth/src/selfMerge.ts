/**
 * Self-merge prevention (4-eyes): repositories compare the merge signer's
 * identity to commit authors. Authorization only enforces the merge role floor;
 * this module owns the author comparison.
 *
 * Commit `author` is the canonical `iss|sub` from author injection
 * (`.scratch/authentication/issues/08-human-commit-author.md`).
 */
import { canonicalIssuer } from './authentication/session/principal.js'

export const SELF_MERGE_FORBIDDEN = 'Self-merge forbidden (4-eyes principle)'

export type SelfMergeDecision =
  | { allow: true }
  | { allow: false; reason: typeof SELF_MERGE_FORBIDDEN; matchingAuthors: string[] }

/** Same string written into oxen commit `author` for a Principal. */
export function signerAuthorKey(signer: { iss: string; sub: string }): string {
  return `${canonicalIssuer(signer.iss)}|${signer.sub}`
}

/**
 * Deny when the Principal performing the merge authored any commit in the merge.
 */
export function decideSelfMerge(
  signer: { iss: string; sub: string },
  authors: readonly string[],
): SelfMergeDecision {
  const key = signerAuthorKey(signer)
  const matchingAuthors = [...new Set(authors.filter((a) => a === key))]
  if (matchingAuthors.length > 0) {
    return { allow: false, reason: SELF_MERGE_FORBIDDEN, matchingAuthors }
  }
  return { allow: true }
}

export function authorsFromCommits(commits: readonly { author?: unknown }[]): string[] {
  const out: string[] = []
  for (const c of commits) {
    if (typeof c.author === 'string' && c.author.trim()) out.push(c.author.trim())
  }
  return out
}

/**
 * Single seam for the 4-eyes check over an oxen mergeable payload's commits list.
 */
export function evaluateSelfMergeFromCommits(
  signer: { iss: string; sub: string },
  commits: readonly { author?: unknown }[],
): SelfMergeDecision {
  return decideSelfMerge(signer, authorsFromCommits(commits))
}
