import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { SessionCreateModal } from '../components/SessionCreateModal'
import { SessionSummaryCard } from '../components/SessionSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  listSessions,
  sessionsMountingRepoWorkspace,
} from '../lib/sessions'

/** Repository sessions list — detail lives on the global Session page. */
export function RepoSessionsPage() {
  const { namespace = '', repo = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const [createOpen, setCreateOpen] = useState(false)

  const state = useAsync((signal) => listSessions(signal), [namespace, repo])
  const all = state.kind === 'ok' ? state.data.sessions : []
  const sessions = sessionsMountingRepoWorkspace(all, namespace, repo)
  const slice = paginate(sessions, page, PAGE_SIZE)

  function goPage(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next <= 1) nextParams.delete('page')
    else nextParams.set('page', String(next))
    setParams(nextParams, { replace: true })
  }

  return (
    <main className="page wide">
      <header className="page-head">
        <div>
          <h1>Sessions</h1>
          <p className="lede">
            Desktop sessions that mount a workspace of{' '}
            <code className="mono">
              {namespace}/{repo}
            </code>
            . Open a session for connect, stop, or destroy.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreateOpen(true)}
          >
            New session
          </button>
          <Link className="btn ghost" to="/sessions">
            All sessions
          </Link>
        </div>
      </header>

      {createOpen && (
        <SessionCreateModal
          onClose={() => setCreateOpen(false)}
          filterRepo={{ namespace, repo }}
        />
      )}

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && sessions.length === 0}
        emptyMessage={
          <>
            <p className="muted">
              No sessions mount a workspace of this repository yet.
            </p>
            <button
              className="btn primary"
              onClick={() => setCreateOpen(true)}
            >
              New session
            </button>
          </>
        }
      >
        {state.kind === 'ok' && sessions.length > 0 && (
          <>
            <ul className="card-list">
              {slice.items.map((s) => (
                <li key={s.id}>
                  <SessionSummaryCard session={s} />
                </li>
              ))}
            </ul>
            <Pagination
              page={slice.page}
              pageCount={slice.pageCount}
              onPageChange={goPage}
              label="Sessions pages"
              total={slice.total}
            />
          </>
        )}
      </StateBlock>
    </main>
  )
}
