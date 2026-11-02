import { FolderOpen as ActionFolderOpen, History as ActionHistory, Trash2 as ActionTrash2 } from 'lucide-react'
import { MetaPanel } from '../components/MetaPanel'
import { useEffect, useState } from 'react'
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { AuthorAvatar } from '../components/AuthorAvatar'
import { CommitEmail } from '../components/CommitEmail'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { CommitList } from '../components/CommitList'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  getCommit,
  getRootCommit,
  listAllCommits,
  listBranches,
  listCommitHistory,
} from '../lib/oxen/api'
import { looksLikeCommitId } from '../lib/oxen/paths'
import { formatRelativeTime } from '../lib/time'

export function CommitsPage() {
  const { namespace = '', repo = '', commitId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<'history' | 'all'>('history')
  const revision = params.get('branch') || 'main'
  const pathFilter = params.get('path') || ''
  const [pathDraft, setPathDraft] = useState(pathFilter)

  useEffect(() => {
    setPathDraft(pathFilter)
  }, [pathFilter])

  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )
  const branchNames =
    branches.kind === 'ok'
      ? branches.data.branches.map((b) => b.name)
      : []
  const revisionIsBranch =
    branches.kind === 'ok'
      ? branchNames.includes(revision)
      : !looksLikeCommitId(revision)

  const history = useAsync(
    (signal) =>
      listCommitHistory(
        namespace,
        repo,
        revision,
        signal,
        pathFilter.trim() || undefined,
      ),
    [namespace, repo, revision, pathFilter],
  )
  const all = useAsync(
    (signal) => listAllCommits(namespace, repo, signal),
    [namespace, repo],
  )
  const root = useAsync(
    (signal) => getRootCommit(namespace, repo, signal),
    [namespace, repo],
  )

  const active = mode === 'history' ? history : all
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const linkSearch = params.toString() ? `?${params.toString()}` : ''
  const listHref = `${base}/commits${linkSearch}`

  // Desktop: always keep a commit selected so the inspector isn’t empty.
  // Narrow: stay on the list until the user picks one.
  useEffect(() => {
    if (active.kind !== 'ok') return
    const commits = active.data.commits
    if (commits.length === 0) return
    const stillVisible = Boolean(
      commitId && commits.some((c) => c.id === commitId),
    )
    if (stillVisible) return

    const narrow =
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 900px)').matches

    if (narrow) {
      if (commitId) navigate(listHref, { replace: true })
      return
    }

    const next = commits[0]!
    navigate(
      `${base}/commits/${encodeURIComponent(next.id)}${linkSearch}`,
      { replace: true },
    )
  }, [active, commitId, base, linkSearch, listHref, navigate])

  const detail = useAsync(
    (signal) =>
      commitId
        ? getCommit(namespace, repo, commitId, signal)
        : Promise.resolve(null),
    [namespace, repo, commitId],
  )

  function setHistoryParams(nextRevision: string, nextPath: string) {
    const next: Record<string, string> = { branch: nextRevision }
    if (nextPath.trim()) next.path = nextPath.trim()
    setParams(next)
  }

  const revisionLabel = revisionIsBranch
    ? revision
    : `${revision.slice(0, 8)}${revision.length > 8 ? '…' : ''}`

  const commit = detail.kind === 'ok' ? detail.data?.commit ?? null : null

  return (
    <main
      className={
        commitId
          ? 'page wide history-page has-detail'
          : 'page wide history-page'
      }
    >
      <header className="history-page-head">
        <div className="history-page-head-main">
          <Breadcrumbs
            items={repoCrumbs(namespace, repo, {
              label: 'History',
              to: listHref,
            })}
          />
          <h1>History</h1>
          {root.kind === 'ok' && (
            <p className="history-root muted small">
              Root{' '}
              <Link
                className="mono"
                to={`${base}/commits/${encodeURIComponent(root.data.commit.id)}${linkSearch}`}
              >
                {root.data.commit.id.slice(0, 8)}
              </Link>
              {' · '}
              {root.data.commit.message}
            </p>
          )}
        </div>

        <div className="history-toolbar">
          <div className="history-mode">
            <span className="history-mode-spacer" aria-hidden>
              Mode
            </span>
            <div className="seg" role="tablist" aria-label="History mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'history'}
                className={mode === 'history' ? 'active' : ''}
                onClick={() => setMode('history')}
              >
                <ActionHistory size={14} aria-hidden="true" className="button-label-icon" />Revision history
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'all'}
                className={mode === 'all' ? 'active' : ''}
                onClick={() => setMode('all')}
              >
                <ActionHistory size={14} aria-hidden="true" className="button-label-icon" />All commits
              </button>
            </div>
          </div>

          {mode === 'history' && (
            <div className="history-filters">
              <label className="branch-pick">
                Revision
                <select
                  value={revision}
                  onChange={(e) => setHistoryParams(e.target.value, pathFilter)}
                >
                  {branches.kind === 'ok' && !revisionIsBranch && (
                    <option value={revision}>
                      {revisionLabel} (commit)
                    </option>
                  )}
                  {branchNames.length > 0 ? (
                    branchNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))
                  ) : (
                    <option value={revision}>
                      {revisionIsBranch ? revision : `${revisionLabel} (commit)`}
                    </option>
                  )}
                </select>
              </label>
              <label className="branch-pick history-path-pick">
                Path
                <input
                  value={pathDraft}
                  onChange={(e) => setPathDraft(e.target.value)}
                  onBlur={() => {
                    if (pathDraft.trim() !== pathFilter.trim()) {
                      setHistoryParams(revision, pathDraft)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setHistoryParams(revision, pathDraft)
                    }
                  }}
                  placeholder="e.g. data or README.md"
                />
              </label>
              {pathFilter.trim() && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    setPathDraft('')
                    setHistoryParams(revision, '')
                  }}
                >
                  <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {mode === 'history' && pathFilter.trim() && (
        <p className="history-filter-note muted small">
          Showing commits that touch <code>{pathFilter.trim()}</code> on{' '}
          <code>{revisionLabel}</code>.
        </p>
      )}

      <div className="history-layout">
        <section className="history-list" aria-label="Commit list">
          <StateBlock
            loading={active.kind === 'loading'}
            error={active.kind === 'error' ? active.message : null}
            empty={active.kind === 'ok' && active.data.commits.length === 0}
            emptyMessage={
              mode === 'history' && pathFilter.trim()
                ? `No commits touch “${pathFilter.trim()}” on ${revisionLabel}.`
                : 'No commits yet.'
            }
          >
            {active.kind === 'ok' && (
              <CommitList
                namespace={namespace}
                repo={repo}
                commits={active.data.commits}
                selectedId={commitId || undefined}
                linkSearch={linkSearch}
              />
            )}
          </StateBlock>
        </section>

        {commitId && (
          <aside className="history-detail" aria-label="Commit detail">
            <Link className="history-detail-back muted small" to={listHref}>
              ← All commits
            </Link>

            <StateBlock
              loading={detail.kind === 'loading'}
              error={detail.kind === 'error' ? detail.message : null}
            >
              {commit && (
                <>
                  <div className="history-detail-top">
                    <h2 className="history-detail-title">{commit.message}</h2>
                    <Link
                      className="btn ghost small"
                      to={`${base}/tree/${commit.id}`}
                    >
                      <ActionFolderOpen size={14} aria-hidden="true" className="button-label-icon" />Browse tree
                    </Link>
                  </div>

                  <div className="history-detail-identity">
                    <AuthorAvatar name={commit.author} />
                    <p className="history-detail-byline muted small">
                      <span>{commit.author}</span>
                      <CommitEmail author={commit.author} stored={commit.email} />
                      <time
                        dateTime={commit.timestamp}
                        title={new Date(commit.timestamp).toLocaleString()}
                      >
                        {formatRelativeTime(commit.timestamp)}
                      </time>
                    </p>
                  </div>

                  <p className="history-detail-meta muted small">
                    <span className="commit-sha mono" title={commitId}>
                      {commitId.slice(0, 12)}
                    </span>
                    <span className="history-parents">
                      <span>Parents</span>
                      {commit.parent_ids.length === 0 ? (
                        <span>—</span>
                      ) : (
                        <span className="history-parent-links">
                          {commit.parent_ids.map((id) => (
                            <Link
                              key={id}
                              className="mono"
                              to={`${base}/commits/${encodeURIComponent(id)}${linkSearch}`}
                            >
                              {id.slice(0, 8)}
                            </Link>
                          ))}
                        </span>
                      )}
                    </span>
                  </p>
                  <MetaPanel key={commit.id} type="commit" id={`${namespace}/${repo}#${commit.id}`} />
                </>
              )}
            </StateBlock>
          </aside>
        )}
      </div>
    </main>
  )
}
