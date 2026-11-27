/** ADR 0009 — commit QC disposition (greenfield). */
export type CommitQcStatus = 'unset' | 'valid' | 'invalid'

export type QcCommit = { id: string; parent_ids: string[] }

/** Cap per view: one GET per commit, so only the newest commits are checked. */
export const COMMIT_QC_LIMIT = 50
const CONCURRENCY = 8

/** Normalize API / transitional payloads to Unset | Valid | Invalid. */
export function normalizeCommitQc(raw: unknown): CommitQcStatus {
  if (raw === 'valid' || raw === 'invalid' || raw === 'unset') return raw
  // Transitional aliases while auth Slice A lands.
  if (raw === 'passed') return 'valid'
  if (raw === 'failed') return 'invalid'
  if (raw === 'none' || raw === 'marked' || raw == null) return 'unset'
  return 'unset'
}

export function isUnsetQc(status: CommitQcStatus | undefined): boolean {
  return normalizeCommitQc(status) === 'unset'
}

export function qcStatusLabel(status: CommitQcStatus | undefined): string {
  switch (normalizeCommitQc(status)) {
    case 'valid':
      return 'Valid'
    case 'invalid':
      return 'Invalid'
    default:
      return 'Unset'
  }
}

/** Pill / tag copy on history rows (includes QC prefix). */
export function qcStatusPillLabel(status: CommitQcStatus | undefined): string {
  return `QC ${qcStatusLabel(status)}`
}

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
  if (!res.ok) return 'unset'
  const body = (await res.json().catch(() => ({}))) as { status?: unknown }
  return normalizeCommitQc(body.status)
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
      out[id] = await fetchCommitQc(namespace, repo, id, signal).catch(() => 'unset' as const)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
  return out
}

export type QcInvalidSummary = {
  /** Commits whose own QC status is Invalid. */
  invalid: string[]
  /** Commits that are not Invalid themselves but descend from an Invalid commit in the list. */
  descendants: string[]
}

/** @deprecated Prefer QcInvalidSummary — kept for call-site renames in progress. */
export type QcFailureSummary = QcInvalidSummary & { failed: string[] }

/**
 * Invalid commits and their descendants, following `parent_ids` among the commits given.
 * Descent is only known for commits present in the list.
 */
export function summarizeQcInvalid(
  commits: QcCommit[],
  qc: Record<string, CommitQcStatus>,
): QcInvalidSummary {
  const byId = new Map(commits.map((c) => [c.id, c]))
  const memo = new Map<string, boolean>()
  const descendsFromInvalid = (id: string, seen = new Set<string>()): boolean => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (seen.has(id)) return false
    seen.add(id)
    const commit = byId.get(id)
    const result = (commit?.parent_ids ?? []).some(
      (p) =>
        normalizeCommitQc(qc[p]) === 'invalid' ||
        (byId.has(p) && descendsFromInvalid(p, seen)),
    )
    memo.set(id, result)
    return result
  }
  const invalid: string[] = []
  const descendants: string[] = []
  for (const c of commits) {
    if (normalizeCommitQc(qc[c.id]) === 'invalid') invalid.push(c.id)
    else if (descendsFromInvalid(c.id)) descendants.push(c.id)
  }
  return { invalid, descendants }
}

/** Alias used by older call sites; same as summarizeQcInvalid with `failed` = `invalid`. */
export function summarizeQcFailures(
  commits: QcCommit[],
  qc: Record<string, CommitQcStatus>,
): QcFailureSummary {
  const s = summarizeQcInvalid(commits, qc)
  return { ...s, failed: s.invalid }
}

export function hasQcInvalid(summary: QcInvalidSummary): boolean {
  return summary.invalid.length > 0 || summary.descendants.length > 0
}

/** @deprecated Prefer hasQcInvalid. */
export function hasQcFailures(summary: QcInvalidSummary | QcFailureSummary): boolean {
  if ('failed' in summary && Array.isArray(summary.failed)) {
    return summary.failed.length > 0 || summary.descendants.length > 0
  }
  return hasQcInvalid(summary)
}
