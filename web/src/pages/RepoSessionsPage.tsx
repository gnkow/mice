import { Monitor as ActionMonitor } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { FavoriteStar } from '../components/FavoriteStar'
import { ListToolbar } from '../components/ListToolbar'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { SessionCreateModal } from '../components/SessionCreateModal'
import { SessionSummaryCard } from '../components/SessionSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useListSort, type SortFields } from '../components/SortControl'
import { useAsync } from '../hooks/useAsync'
import { useFavorites } from '../lib/favorites'
import {
  listSessions,
  sessionsMountingRepoWorkspace,
  type DesktopSession,
} from '../lib/sessions'

const SESSION_SORTS: SortFields<DesktopSession> = { name: (x) => x.id, created: (x) => x.created_at }

/** Repository sessions list — detail lives on the global Session page. */
export function RepoSessionsPage() {
  const { namespace = '', repo = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const [createOpen, setCreateOpen] = useState(false)

  const state = useAsync((signal) => listSessions(signal), [namespace, repo])
  const all = state.kind === 'ok' ? state.data.sessions : []
  const mounting = sessionsMountingRepoWorkspace(all, namespace, repo)
  const [filter, setFilter] = useState('')
  const sort = useListSort('repo-sessions', SESSION_SORTS)
  const favs = useFavorites()
  const sessions = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const matching = needle
      ? mounting.filter((s) => [s.id, s.status, s.owner.name, s.owner.email].some((v) => (v ?? '').toLowerCase().includes(needle)))
      : mounting
    return sort.apply(matching, (s) => favs.has('session', s.id))
  }, [mounting, filter, sort.apply, favs])
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
            Remote desktop sessions connected to workspaces in{' '}
            <code className="mono">
              {namespace}/{repo}
            </code>
            . Open a session to connect, stop, or remove it.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreateOpen(true)}
          >
            <ActionMonitor size={14} aria-hidden="true" className="button-label-icon" />New session
          </button>
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
        empty={state.kind === 'ok' && mounting.length === 0}
        emptyMessage="No sessions mount a workspace of this repository yet. Use the New session button above to get started."
      >
        {state.kind === 'ok' && mounting.length > 0 && (
          <>
            <ListToolbar
              id="repo-sessions"
              sort={sort}
              search={{ value: filter, onChange: setFilter, placeholder: 'Filter by id, status or owner' }}
              meta={`${sessions.length} session${sessions.length === 1 ? '' : 's'}${filter.trim() ? ' matching' : ''}`}
            />
            <ul className="card-list">
              {slice.items.map((s) => (
                <li key={s.id} className="fav-row">
                  <SessionSummaryCard session={s} />
                  <FavoriteStar type="session" id={s.id} className="fav-row-star" />
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
