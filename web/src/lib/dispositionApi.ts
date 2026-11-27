import { authzFetch } from './authzApi'
import type { DispositionMap, DispositionValue } from './disposition'

/**
 * Ad-hoc signed disposition map (ADR 0009).
 * POST /auth/repos/:ns/:repo/commits/disposition — write+, ceremony via authzFetch.
 */
export function postCommitDisposition(
  namespace: string,
  repo: string,
  disposition: DispositionMap,
) {
  return authzFetch<{ ok?: boolean; disposition?: DispositionMap }>(
    `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/commits/disposition`,
    {
      method: 'POST',
      body: JSON.stringify({ disposition }),
    },
  )
}

export type CommitDispositionHistoryRow = {
  id: string
  status: DispositionValue
  signatureId: string
  actorKey: string
  at: string
}

export type CommitDispositionDetail = {
  commitId: string
  status: 'unset' | 'valid' | 'invalid'
  history: CommitDispositionHistoryRow[]
}

/** Current QC + append-only disposition history. */
export function fetchCommitDisposition(
  namespace: string,
  repo: string,
  commitId: string,
  signal?: AbortSignal,
) {
  return authzFetch<CommitDispositionDetail>(
    `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(commitId)}/disposition`,
    { signal },
  )
}
