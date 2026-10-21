import { useEffect, useMemo } from 'react'
import { useAsync } from '../hooks/useAsync'
import { listCommitHistory } from '../lib/oxen/api'
import { formatRelativeTime } from '../lib/time'

type Props = {
  namespace: string
  repo: string
  /** Branch whose history is listed. */
  branch: string
  /** Selected commit id (empty until loaded). */
  value: string
  onChange: (commitId: string) => void
  label?: string
  disabled?: boolean
}

export function CommitSelector({
  namespace,
  repo,
  branch,
  value,
  onChange,
  label = 'Commit',
  disabled,
}: Props) {
  const history = useAsync(
    (signal) => listCommitHistory(namespace, repo, branch, signal),
    [namespace, repo, branch],
  )
  const commits = useMemo(
    () =>
      history.kind === 'ok'
        ? [...history.data.commits].sort((a, b) =>
            a.timestamp < b.timestamp ? 1 : -1,
          )
        : [],
    [history],
  )

  // Keep the selection valid: default to the newest commit of the branch.
  useEffect(() => {
    if (commits.length === 0) return
    if (!commits.some((c) => c.id === value)) onChange(commits[0].id)
  }, [commits, value, onChange])

  return (
    <label>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || history.kind === 'loading' || commits.length === 0}
        aria-label={label}
        className="mono"
      >
        {commits.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id.slice(0, 8)} · {c.message.split('\n')[0].slice(0, 60)} ·{' '}
            {formatRelativeTime(c.timestamp)}
          </option>
        ))}
      </select>
      {history.kind === 'error' && (
        <span className="field-hint error-text">
          Could not load commits: {history.message}
        </span>
      )}
      {history.kind === 'ok' && commits.length === 0 && (
        <span className="field-hint">No commits on {branch}</span>
      )}
    </label>
  )
}
