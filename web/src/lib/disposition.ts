import {
  COMMIT_QC_LIMIT,
  fetchCommitsQc,
  isUnsetQc,
  type CommitQcStatus,
} from './commitQc'
import { normalizePrincipalAuthorKey, principalAuthorKey } from './mergeRequests'
import { listCommitHistory } from './oxen/api'

/** Disposition assigned in a signed map (ADR 0009). */
export type DispositionValue = 'valid' | 'invalid'

/** commitId → Valid | Invalid. */
export type DispositionMap = Record<string, DispositionValue>

/**
 * Sentinel key for the merge commit before its id exists at complete time.
 * Auth Slice A should remap this to the real merge commit id after oxen merge.
 */
export const MERGE_COMMIT_DISPOSITION_KEY = '__merge_commit__'

export type DispositionCommitRow = {
  id: string
  message: string
  author: string
  currentQc?: CommitQcStatus
  /** Synthetic row for the merge commit created on complete. */
  isMergeCommit?: boolean
}

/** Default every listed commit (and optional merge sentinel) to Valid. */
export function defaultDispositionMap(
  commitIds: readonly string[],
  opts?: { includeMergeCommit?: boolean },
): DispositionMap {
  const map: DispositionMap = {}
  for (const id of commitIds) {
    if (id) map[id] = 'valid'
  }
  if (opts?.includeMergeCommit) {
    map[MERGE_COMMIT_DISPOSITION_KEY] = 'valid'
  }
  return map
}

/**
 * Authors cannot Valid their own commits — coerce those entries to Invalid
 * so the submitted map matches the UI (avoids self_valid deadlock).
 */
export function coerceDispositionForSigner(
  map: DispositionMap,
  rows: readonly DispositionCommitRow[],
  signer: { iss: string; sub: string } | null | undefined,
): DispositionMap {
  if (!signer?.iss || !signer?.sub) return map
  const next = { ...map }
  for (const row of rows) {
    if (row.isMergeCommit || row.id === MERGE_COMMIT_DISPOSITION_KEY) continue
    if (signerAuthoredCommit(signer, row.author) && next[row.id] === 'valid') {
      next[row.id] = 'invalid'
    }
  }
  return next
}

/** True when the signer authored/co-authored the commit (cannot set Valid). */
export function signerAuthoredCommit(
  signer: { iss: string; sub: string } | null | undefined,
  author: string | null | undefined,
): boolean {
  if (!signer?.iss || !signer?.sub || !author?.trim()) return false
  return normalizePrincipalAuthorKey(author) === principalAuthorKey(signer)
}

/**
 * Parse disposition from a mark/complete/ad-hoc body (`disposition` or `dispositionMap`).
 */
export function readDispositionFromBody(body: unknown): DispositionMap | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const raw =
    (body as { disposition?: unknown }).disposition ??
    (body as { dispositionMap?: unknown }).dispositionMap
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: DispositionMap = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === 'valid' || value === 'invalid') out[id] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Unset tip-ancestry commits that need a disposition map when marking validated. */
export async function listUnsetTipCommits(
  namespace: string,
  repo: string,
  revision: string,
  signal?: AbortSignal,
): Promise<DispositionCommitRow[]> {
  const hist = await listCommitHistory(namespace, repo, revision, signal)
  const commits = hist.commits.slice(0, COMMIT_QC_LIMIT)
  if (commits.length === 0) return []
  const qc = await fetchCommitsQc(
    namespace,
    repo,
    commits.map((c) => c.id),
    signal,
  )
  return commits
    .filter((c) => isUnsetQc(qc[c.id]))
    .map((c) => ({
      id: c.id,
      message: c.message,
      author: c.author,
      currentQc: 'unset' as const,
    }))
}
