import { useMemo } from 'react'
import {
  COMMIT_QC_LIMIT,
  fetchCommitsQc,
  summarizeQcInvalid,
  type CommitQcStatus,
  type QcCommit,
  type QcInvalidSummary,
} from '../lib/commitQc'
import { useAsync } from './useAsync'

const EMPTY: Record<string, CommitQcStatus> = {}

/** QC status + Invalid summary for the newest commits in a list (ADR 0009). */
export function useCommitQc(
  namespace: string,
  repo: string,
  commits: QcCommit[] | null | undefined,
): {
  qc: Record<string, CommitQcStatus>
  summary: QcInvalidSummary
  reload: () => void
} {
  const ids = (commits ?? []).slice(0, COMMIT_QC_LIMIT).map((c) => c.id)
  const key = ids.join(',')
  const state = useAsync(
    (signal) =>
      ids.length > 0
        ? fetchCommitsQc(namespace, repo, ids, signal)
        : Promise.resolve(EMPTY),
    [namespace, repo, key],
  )
  const qc = state.kind === 'ok' ? state.data : EMPTY
  const summary = useMemo(
    () => summarizeQcInvalid((commits ?? []).slice(0, COMMIT_QC_LIMIT), qc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, qc],
  )
  return { qc, summary, reload: state.reload }
}
