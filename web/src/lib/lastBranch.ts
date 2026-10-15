/** Remember last browsed branch per repo for Files nav. */

import { looksLikeCommitId } from './oxen/paths'

function key(namespace: string, repo: string) {
  return `boxen.lastBranch.${namespace}/${repo}`
}

export function rememberBranch(
  namespace: string,
  repo: string,
  branch: string,
) {
  if (!namespace || !repo || !branch) return
  // Detached commit browsing must not overwrite the last real branch.
  if (looksLikeCommitId(branch)) return
  try {
    localStorage.setItem(key(namespace, repo), branch)
  } catch {
    /* ignore quota */
  }
}

export function lastBranch(
  namespace: string,
  repo: string,
  fallback = 'main',
): string {
  try {
    return localStorage.getItem(key(namespace, repo)) || fallback
  } catch {
    return fallback
  }
}

/** Prefer first branch that isn't `base`, else null. */
export function pickOtherBranch(
  names: string[],
  base: string,
): string | null {
  return names.find((n) => n !== base) ?? null
}

function defaultBranchKey(namespace: string, repo: string) {
  return `boxen.defaultBranch.${namespace}/${repo}`
}

/** Optional per-repo default override (browser-local; oxen-server has no default API). */
export function getStoredDefaultBranch(
  namespace: string,
  repo: string,
): string | null {
  try {
    return localStorage.getItem(defaultBranchKey(namespace, repo))
  } catch {
    return null
  }
}

export function setStoredDefaultBranch(
  namespace: string,
  repo: string,
  branch: string,
): void {
  if (!namespace || !repo || !branch) return
  try {
    localStorage.setItem(defaultBranchKey(namespace, repo), branch)
  } catch {
    /* ignore quota */
  }
}

/**
 * Resolve default branch: stored override if still present, else `main` if
 * listed, else the first branch name.
 */
export function resolveDefaultBranch(
  names: string[],
  namespace = '',
  repo = '',
  preferred = 'main',
): string {
  const stored =
    namespace && repo ? getStoredDefaultBranch(namespace, repo) : null
  if (stored && names.includes(stored)) return stored
  if (names.includes(preferred)) return preferred
  return names[0] ?? preferred
}
