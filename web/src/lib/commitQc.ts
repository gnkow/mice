export type CommitQcStatus = 'none' | 'marked' | 'passed' | 'failed'

export type QcCommit = { id: string; parent_ids: string[] }

/** Cap per view: one GET per commit, so only the newest commits are checked. */
export const COMMIT_QC_LIMIT = 50
const CONCURRENCY = 8

export async function fetchCommitQc(
  namespace: string,
  repo: string,
  commitId: string,
  signal?: AbortSignal,
): Promise<CommitQcStatus> {
  const res = await fetch(
    `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(commitId)}/qc`,
    { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal },
  )
  // Repositories unknown to AuthZ (or unreadable) have no QC record; never block the page on it.
  if (!res.ok) return 'none'
  const body = (await res.json().catch(() => ({}))) as { status?: CommitQcStatus }
  return body.status ?? 'none'
}

/** QC status for the newest `COMMIT_QC_LIMIT` commits, fetched with bounded concurrency. */
export async function fetchCommitsQc(
  namespace: string,
  repo: string,
  commitIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, CommitQcStatus>> {
  const ids = [...new Set(commitIds)].slice(0, COMMIT_QC_LIMIT)
  const out: Record<string, CommitQcStatus> = {}
  let next = 0
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++]!
      out[id] = await fetchCommitQc(namespace, repo, id, signal).catch(() => 'none' as const)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
  return out
}

export type QcFailureSummary = {
  /** Commits whose own QC status is failed. */
  failed: string[]
  /** Commits that are not failed themselves but descend from a failed commit in the list. */
  descendants: string[]
}

/**
 * Failed commits and their descendants, following `parent_ids` among the commits given.
 * Descent is only known for commits present in the list.
 */
export function summarizeQcFailures(
  commits: QcCommit[],
  qc: Record<string, CommitQcStatus>,
): QcFailureSummary {
  const byId = new Map(commits.map((c) => [c.id, c]))
  const memo = new Map<string, boolean>()
  const descendsFromFailed = (id: string, seen = new Set<string>()): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (seen.has(id)) return false
    seen.add(id)
    const commit = byId.get(id)
    const result = (commit?.parent_ids ?? []).some(
      (p) => qc[p] === 'failed' || (byId.has(p) && descendsFromFailed(p, seen)),
    )
    memo.set(id, result)
    return result
  }
  const failed: string[] = []
  const descendants: string[] = []
  for (const c of commits) {
    if (qc[c.id] === 'failed') failed.push(c.id)
    else if (descendsFromFailed(c.id)) descendants.push(c.id)
  }
  return { failed, descendants }
}

export function hasQcFailures(summary: QcFailureSummary): boolean {
  return summary.failed.length > 0 || summary.descendants.length > 0
}
