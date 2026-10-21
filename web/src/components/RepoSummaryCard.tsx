import { Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { deleteRepository, getRepository, listCommitHistory, listWorkspaces } from '../lib/oxen/api'
import { formatBytes } from '../lib/oxen/client'
import { confirmDelete } from '../lib/confirmDelete'
import { lastBranch } from '../lib/lastBranch'
import { loadRepoSocial } from '../lib/repoSocial'
import { formatRelativeTime } from '../lib/time'
import { MetaPills } from './MetaPills'
import { StarIcon } from './icons'
import { VisibilityPill } from './VisibilityPill'

type Props = {
  namespace: string
  name: string
  /** Prefix the title with its namespace (for cross-namespace lists). */
  showNamespace?: boolean
  /** Called after the repository was deleted from the card. */
  onDeleted?: () => void
}

function summarize(detail: Awaited<ReturnType<typeof getRepository>> | null) {
  if (!detail) return null
  const r = detail.repository
  const files = r.data_types.reduce((n, dt) => n + dt.count, 0)
  const branches = r.branch_count
  const parts = [
    r.is_empty ? 'Empty' : formatBytes(r.size),
    branches != null ? `${branches} branch${branches === 1 ? '' : 'es'}` : null,
    files > 0 ? `${files} file${files === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

export function RepoSummaryCard({ namespace, name, showNamespace, onDeleted }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const detail = useAsync(
    (signal) => getRepository(namespace, name, signal),
    [namespace, name],
  )
  const workspaces = useAsync(
    (signal) => listWorkspaces(namespace, name, signal),
    [namespace, name],
  )
  const branch = lastBranch(namespace, name, 'main')
  const latest = useAsync(
    async (signal) => {
      const res = await listCommitHistory(namespace, name, branch, signal)
      return res.commits.reduce<(typeof res.commits)[number] | null>(
        (best, c) => (!best || c.timestamp > best.timestamp ? c : best),
        null,
      )
    },
    [namespace, name, branch],
  )
  const commit = latest.kind === 'ok' ? latest.data : null
  const dataTypes =
    detail.kind === 'ok'
      ? [...detail.data.repository.data_types]
          .filter((d) => d.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 4)
      : []
  const starred = loadRepoSocial(namespace, name).star

  const href = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(name)}/tree/${encodeURIComponent(lastBranch(namespace, name, 'main'))}`
  const summary =
    detail.kind === 'ok' ? summarize(detail.data) : detail.kind === 'loading' ? '…' : null
  const wsCount =
    workspaces.kind === 'ok' ? workspaces.data.workspaces.length : null
  const meta = [
    summary,
    wsCount != null && wsCount > 0
      ? `${wsCount} workspace${wsCount === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const repoBase = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(name)}`

  async function onDelete() {
    if (
      !(await confirmDelete({
        title: `Delete repository ${namespace}/${name}`,
        detail:
          'The entire repository and all of its history will be permanently removed from the server.',
        confirmWord: name,
      }))
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteRepository(namespace, name)
      onDeleted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="repo-card-wrap">
    <Link className="repo-summary-card has-actions" to={href}>
      <span className="repo-summary-main">
        <span className="card-title">
          {showNamespace && <span className="muted">{namespace} / </span>}
          {name}
        </span>
        <span className="card-meta">{meta || 'Open repository →'}</span>
        {dataTypes.length > 0 && (
          <span className="repo-summary-types small muted">
            {dataTypes.map((d) => `${d.count} ${d.data_type}`).join(' · ')}
          </span>
        )}
        {commit && (
          <span className="repo-summary-commit small muted" title={commit.message}>
            Updated {formatRelativeTime(commit.timestamp)} · {commit.author} · {commit.message.split('\n')[0]}
          </span>
        )}
        <MetaPills type="repo" id={`${namespace}/${name}`} />
      </span>
      <span className="repo-summary-badges">
        <VisibilityPill />
        {starred && (
          <span
            className="visibility-pill star-pill"
            title="Starred in this browser"
            style={{ textTransform: 'none' }}
          >
            <StarIcon filled size={12} />
            1
          </span>
        )}
      </span>
    </Link>
    <div className="repo-card-actions">
      <Link
        className="icon-round"
        to={`${repoBase}/settings`}
        aria-label={`Settings for ${namespace}/${name}`}
        title={`Settings for ${namespace}/${name}`}
      >
        <Settings size={14} aria-hidden />
      </Link>
      <button
        type="button"
        className="icon-round branch-delete"
        disabled={busy}
        aria-label={`Delete repository ${namespace}/${name}`}
        title={busy ? 'Deleting…' : `Delete ${namespace}/${name}`}
        onClick={() => void onDelete()}
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
    {error && <p className="flash flash-error" role="status">{error}</p>}
    </div>
  )
}
