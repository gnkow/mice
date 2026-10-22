import { Monitor as ActionMonitor, Trash2 as ActionTrash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { SessionCreateModal } from '../components/SessionCreateModal'
import { SessionSummaryCard } from '../components/SessionSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import { listSessions, sessionMounts, type DesktopSession } from '../lib/sessions'
import { FavoriteStar } from '../components/FavoriteStar'
import { SortControl, useListSort, type SortFields } from '../components/SortControl'
import { useFavorites } from '../lib/favorites'

const SESSIONS_SORTS: SortFields<DesktopSession> = { name: (x) => x.id, created: (x) => x.created_at }

export function SessionsListPage() {
  const state = useAsync((signal) => listSessions(signal), [])
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState(params.get('q') ?? '')
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const sessions = state.kind === 'ok' ? state.data.sessions : []

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((session) => {
      const mounts = sessionMounts(session)
      const mountStrings = mounts.map(m => `${m.namespace}/${m.repo}`)
      return session.id.toLowerCase().includes(q) ||
             session.status.toLowerCase().includes(q) ||
             mountStrings.some(m => m.toLowerCase().includes(q))
    })
  }, [sessions, filter])

  const sort = useListSort('sessions', SESSIONS_SORTS)
  const favs = useFavorites()
  const ordered = useMemo(
    () => sort.apply(filtered, (x) => favs.has('session', x.id)),
    [filtered, sort.apply, favs],
  )
  const slice = paginate(ordered, page, PAGE_SIZE)
  const [createOpen, setCreateOpen] = useState(false)
  const canCreateSession =
    authz.kind === 'ok' &&
    !!authz.data &&
    (!authz.data.enforce ||
      authz.data.instanceAdmin ||
      authz.data.permissions.session_create ||
      authz.data.permissions.session_admin)

  function goPage(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next <= 1) nextParams.delete('page')
    else nextParams.set('page', String(next))
    setParams(nextParams, { replace: true })
  }

  function onFilterChange(value: string) {
    setFilter(value)
    const nextParams = new URLSearchParams(params)
    if (value.trim()) nextParams.set('q', value.trim())
    else nextParams.delete('q')
    nextParams.delete('page')
    setParams(nextParams, { replace: true })
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p className="lede">
            Your personal remote desktop environments for working with data. Connect one or more workspaces to access your files.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreateOpen(true)}
            disabled={!canCreateSession}
            title={
              !canCreateSession
                ? 'Requires session_create instance permission'
                : undefined
            }
          >
            <ActionMonitor size={14} aria-hidden="true" className="button-label-icon" />New session
          </button>
        </div>
      </div>

      {createOpen && <SessionCreateModal onClose={() => setCreateOpen(false)} />}

      <div className="ns-toolbar">
        <SortControl id="sessions" sort={sort} />
        <div className="ns-search-field">
          <label className="ns-search-label" htmlFor="session-filter">
            Search
          </label>
          <div className="ns-search-control">
            <span className="ns-search-icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M10.5 10.5L14 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              id="session-filter"
              type="search"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Filter by ID, status, or repository"
              autoComplete="off"
            />
            {filter.trim() ? (
              <button
                type="button"
                className="ns-search-clear"
                onClick={() => onFilterChange('')}
                aria-label="Clear search"
              >
                <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
              </button>
            ) : null}
          </div>
        </div>
        {state.kind === 'ok' && (
          <p className="muted small ns-toolbar-meta">
            {filtered.length} session{filtered.length === 1 ? '' : 's'}
            {filter.trim() ? ' matching' : ''}
          </p>
        )}
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && filtered.length === 0}
        emptyMessage={
          filter.trim()
            ? `No sessions match "${filter.trim()}".`
            : <>No sessions yet. Create one to provision a desktop.</>
        }
      >
        {state.kind === 'ok' && (
          <>
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
