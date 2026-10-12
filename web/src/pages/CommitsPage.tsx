import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { CommitList } from '../components/CommitList'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  getRootCommit,
  listAllCommits,
  listBranches,
  listCommitHistory,
} from '../lib/oxen/api'

export function CommitsPage() {
  const { namespace = '', repo = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<'history' | 'all'>('history')
  const branch = params.get('branch') || 'main'
  const pathFilter = params.get('path') || ''
  const [pathDraft, setPathDraft] = useState(pathFilter)

  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )
  const history = useAsync(
    (signal) =>
      listCommitHistory(
        namespace,
        repo,
        branch,
        signal,
        pathFilter.trim() || undefined,
      ),
    [namespace, repo, branch, pathFilter],
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

  function setHistoryParams(nextBranch: string, nextPath: string) {
    const next: Record<string, string> = { branch: nextBranch }
    if (nextPath.trim()) next.path = nextPath.trim()
    setParams(next)
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Breadcrumbs items={repoCrumbs(namespace, repo, { label: 'Commits' })} />
          <h1>Commits</h1>
          {root.kind === 'ok' && (
            <p className="lede">
              Root{' '}
              <Link
                className="mono"
                to={`${base}/commits/${encodeURIComponent(root.data.commit.id)}`}
              >
                {root.data.commit.id.slice(0, 8)}
              </Link>
              {' — '}
              {root.data.commit.message}
            </p>
          )}
        </div>
      </div>

      <div className="toolbar">
        <div className="seg">
          <button
            type="button"
            className={mode === 'history' ? 'active' : ''}
            onClick={() => setMode('history')}
          >
            Branch history
          </button>
          <button
            type="button"
            className={mode === 'all' ? 'active' : ''}
            onClick={() => setMode('all')}
          >
            All commits
          </button>
        </div>
        {mode === 'history' && (
          <>
            <label className="branch-pick">
              Branch
              <select
                value={branch}
                onChange={(e) => setHistoryParams(e.target.value, pathFilter)}
              >
                {branches.kind === 'ok' ? (
                  branches.data.branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))
                ) : (
                  <option value={branch}>{branch}</option>
                )}
              </select>
            </label>
            <label className="branch-pick">
              Path filter
              <input
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                onBlur={() => {
                  if (pathDraft.trim() !== pathFilter.trim()) {
                    setHistoryParams(branch, pathDraft)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    setHistoryParams(branch, pathDraft)
                  }
                }}
                placeholder="e.g. data or README.md"
              />
            </label>
            {pathFilter.trim() && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setPathDraft('')
                  setHistoryParams(branch, '')
                }}
              >
                Clear path
              </button>
            )}
          </>
        )}
      </div>

      {mode === 'history' && pathFilter.trim() && (
        <p className="muted small">
          Showing commits that touch <code>{pathFilter.trim()}</code> on{' '}
          <code>{branch}</code>.
        </p>
      )}

      <StateBlock
        loading={active.kind === 'loading'}
        error={active.kind === 'error' ? active.message : null}
        empty={active.kind === 'ok' && active.data.commits.length === 0}
        emptyMessage={
          mode === 'history' && pathFilter.trim()
            ? `No commits touch “${pathFilter.trim()}” on ${branch}.`
            : 'No commits yet.'
        }
      >
        {active.kind === 'ok' && (
          <CommitList
            namespace={namespace}
            repo={repo}
            commits={active.data.commits}
          />
        )}
      </StateBlock>
    </main>
  )
}
