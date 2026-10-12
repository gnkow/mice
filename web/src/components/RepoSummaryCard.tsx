import { Link } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { getRepository, listWorkspaces } from '../lib/oxen/api'
import { formatBytes } from '../lib/oxen/client'
import { lastBranch } from '../lib/lastBranch'
import { loadRepoSocial } from '../lib/repoSocial'
import { StarIcon } from './icons'
import { VisibilityPill } from './VisibilityPill'

type Props = {
  namespace: string
  name: string
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

export function RepoSummaryCard({ namespace, name }: Props) {
  const detail = useAsync(
    (signal) => getRepository(namespace, name, signal),
    [namespace, name],
  )
  const workspaces = useAsync(
    (signal) => listWorkspaces(namespace, name, signal),
    [namespace, name],
  )
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

  return (
    <Link className="repo-summary-card" to={href}>
      <span className="repo-summary-main">
        <span className="card-title">{name}</span>
        <span className="card-meta">{meta || 'Open project →'}</span>
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
  )
}
