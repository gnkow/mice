import { Link, useParams } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import {
  getRepository,
  getRepositorySize,
  getRepositoryStats,
  listAllCommits,
  listWorkspaces,
  refreshEntryMetadata,
  updateRepositorySize,
} from '../lib/oxen/api'
import { formatBytes } from '../lib/oxen/client'
import { lastBranch } from '../lib/lastBranch'
import { loadRepoSocial, REPO_SOCIAL_EVENT } from '../lib/repoSocial'
import { OxenApiError } from '../lib/oxen/types'
import { AuthorAvatar } from './AuthorAvatar'
import { DataTypeIcon } from './icons'
import { useEffect, useState } from 'react'

export function RepoAside() {
  const { namespace = '', repo = '' } = useParams()
  const filesHref = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(lastBranch(namespace, repo, 'main'))}`
  const [starred, setStarred] = useState(
    () => loadRepoSocial(namespace, repo).star,
  )

  useEffect(() => {
    setStarred(loadRepoSocial(namespace, repo).star)
    function onSocial(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { namespace: string; repo: string }
        | undefined
      if (detail?.namespace === namespace && detail?.repo === repo) {
        setStarred(loadRepoSocial(namespace, repo).star)
      }
    }
    window.addEventListener(REPO_SOCIAL_EVENT, onSocial)
    return () => window.removeEventListener(REPO_SOCIAL_EVENT, onSocial)
  }, [namespace, repo])

  const detail = useAsync(
    (signal) => getRepository(namespace, repo, signal),
    [namespace, repo],
  )
  const stats = useAsync(
    (signal) => getRepositoryStats(namespace, repo, signal),
    [namespace, repo],
  )
  const size = useAsync(
    (signal) => getRepositorySize(namespace, repo, signal),
    [namespace, repo],
  )
  const commits = useAsync(
    (signal) => listAllCommits(namespace, repo, signal),
    [namespace, repo],
  )
  const workspaces = useAsync(
    (signal) => listWorkspaces(namespace, repo, signal),
    [namespace, repo],
  )

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const repository = detail.kind === 'ok' ? detail.data.repository : null

  const fileCount =
    stats.kind === 'ok'
      ? stats.data.repository.data_types.reduce((n, dt) => n + dt.file_count, 0)
      : repository
        ? repository.data_types.reduce((n, dt) => n + dt.count, 0)
        : null

  const commitCount =
    commits.kind === 'ok'
      ? (commits.data.total_entries ?? commits.data.commits.length)
      : null

  const workspaceCount =
    workspaces.kind === 'ok' ? workspaces.data.workspaces.length : null

  const contributors =
    commits.kind === 'ok'
      ? [
          ...new Map(
            commits.data.commits
              .map((c) => (c.author || '').trim())
              .filter(Boolean)
              .map((name) => [name.toLowerCase(), name]),
          ).values(),
        ]
      : []

  function onRefreshAbout() {
    const branch = lastBranch(namespace, repo, 'main')
    setBusy(true)
    setActionError(null)
    void Promise.all([
      updateRepositorySize(namespace, repo),
      refreshEntryMetadata(namespace, repo, branch, ''),
    ])
      .then(() => {
        size.reload()
        detail.reload()
        stats.reload()
        commits.reload()
      })
      .catch((err) => {
        setActionError(
          err instanceof OxenApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Refresh failed',
        )
      })
      .finally(() => setBusy(false))
  }

  return (
    <aside className="repo-aside hub-aside">
      <section className="repo-aside-panel hub-aside-card">
        <div className="hub-aside-heading-row">
          <h3 className="hub-aside-heading">About</h3>
          {repository && (
            <button
              type="button"
              className="icon-round hub-aside-refresh"
              disabled={busy}
              onClick={onRefreshAbout}
              title="Recalculate size and refresh metadata"
              aria-label="Refresh size and metadata"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path
                  fill="currentColor"
                  d="M8 2.5a5.5 5.5 0 1 0 4.85 2.9.75.75 0 1 1 1.32-.72A7 7 0 1 1 8 1a.75.75 0 0 1 0 1.5Zm3.22.28a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1 0 1.06l-1.5 1.5a.75.75 0 1 1-1.06-1.06l.22-.28H9.25a.75.75 0 0 1 0-1.5h2.19l-.22-.22a.75.75 0 0 1 0-1.06Z"
                />
              </svg>
            </button>
          )}
        </div>
        {detail.kind === 'loading' && <p className="muted">Loading…</p>}
        {detail.kind === 'error' && (
          <p className="error">{detail.message}</p>
        )}
        {repository && (
          <>
            <p className="hub-aside-desc muted small">
              Self-hosted project on oxen-server
              {repository.is_empty ? ' · empty' : ''}.
            </p>
            <ul className="hub-aside-meta">
              <li>
                <strong>{commitCount ?? '—'}</strong>
                <span className="muted">
                  {' '}
                  commit{(commitCount ?? 0) === 1 ? '' : 's'}
                </span>
              </li>
              <li>
                <strong>{contributors.length || '—'}</strong>
                <span className="muted">
                  {' '}
                  contributor{contributors.length === 1 ? '' : 's'}
                </span>
              </li>
              <li>
                <strong>
                  {size.kind === 'ok'
                    ? formatBytes(size.data.size)
                    : formatBytes(repository.size)}
                </strong>
                <span className="muted"> size</span>
              </li>
              <li>
                <strong>{starred ? 1 : 0}</strong>
                <span className="muted">
                  {' '}
                  star{starred ? '' : 's'}
                </span>
              </li>
              <li className="hub-aside-meta-secondary">
                <strong>{repository.branch_count ?? 0}</strong>
                <span className="muted">
                  {' '}
                  branch{(repository.branch_count ?? 0) === 1 ? '' : 'es'}
                </span>
              </li>
              <li className="hub-aside-meta-secondary">
                <strong>{fileCount ?? '—'}</strong>
                <span className="muted">
                  {' '}
                  file{(fileCount ?? 0) === 1 ? '' : 's'}
                </span>
              </li>
              {workspaceCount != null && workspaceCount > 0 && (
                <li className="hub-aside-meta-secondary">
                  <strong>{workspaceCount}</strong>
                  <span className="muted">
                    {' '}
                    workspace{workspaceCount === 1 ? '' : 's'}
                  </span>
                </li>
              )}
            </ul>
            {actionError && <p className="error small">{actionError}</p>}
          </>
        )}
      </section>

      {repository && (repository.data_types?.length ?? 0) > 0 && (
        <section className="repo-aside-panel hub-aside-card">
          <h3 className="hub-aside-heading">Project contents</h3>
          <div className="composition-bar" aria-hidden>
            {(() => {
              const total = repository.data_types.reduce(
                (n, dt) => n + dt.count,
                0,
              )
              const colors = [
                'var(--accent)',
                'var(--brand-pink)',
                'var(--brand-peach)',
                'var(--brand-violet)',
                'var(--success)',
              ]
              return repository.data_types.map((dt, i) => (
                <span
                  key={dt.data_type}
                  style={{
                    width: `${total ? (dt.count / total) * 100 : 0}%`,
                    background: colors[i % colors.length],
                  }}
                />
              ))
            })()}
          </div>
          <ul className="composition-list">
            {repository.data_types.map((dt) => {
              const total = repository.data_types.reduce(
                (n, x) => n + x.count,
                0,
              )
              const pct = total ? ((dt.count / total) * 100).toFixed(1) : '0'
              return (
                <li key={dt.data_type} className="composition-list-item">
                  <DataTypeIcon type={dt.data_type} size={13} />
                  <span>
                    {dt.data_type} {pct}%
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="repo-aside-panel hub-aside-card">
        <h3 className="hub-aside-heading">Contributors</h3>
        {contributors.length > 0 ? (
          <ul className="hub-aside-contributors">
            {contributors.slice(0, 8).map((name) => (
              <li key={name}>
                <AuthorAvatar name={name} />
                <span>@{name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="hub-aside-lonely">
              This repo seems a little lonely, doesn&apos;t it?
            </p>
            <p className="muted small">
              Invite teammates via your oxen-server access controls to
              collaborate.
            </p>
          </>
        )}
        {contributors.length > 0 && contributors.length < 2 && (
          <p className="muted small hub-aside-invite">
            Life is more fun with friends! Invite people via your oxen-server
            access controls.
          </p>
        )}
        <p>
          <Link className="linkish" to={filesHref}>
            Browse files →
          </Link>
        </p>
      </section>
    </aside>
  )
}
