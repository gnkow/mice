import { Monitor as ActionMonitor } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { FavoriteStar } from '../components/FavoriteStar'
import { ListToolbar } from '../components/ListToolbar'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { SessionCreateModal } from '../components/SessionCreateModal'
import { SessionRowActions, useMaySessionConnect } from '../components/SessionRowActions'
import { SessionSummaryCard } from '../components/SessionSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useListSort, type SortFields } from '../components/SortControl'
import { useAsync } from '../hooks/useAsync'
import { isAccessDenial } from '../lib/accessError'
import { fetchAuthzMe, hasEffectivePermission } from '../lib/auth'
import { fetchRepoPermissions } from '../lib/authzApi'
import { useFavorites } from '../lib/favorites'
import { getRepository } from '../lib/oxen/api'
import {
  listSessions,
  sessionsMountingRepo,
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

  const repoAccess = useAsync(
    (signal) => getRepository(namespace, repo, signal),
    [namespace, repo],
  )
  const repoPerms = useAsync(
    (signal) => fetchRepoPermissions(namespace, repo, signal),
    [namespace, repo],
  )
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  const state = useAsync((signal) => listSessions(signal), [namespace, repo])
  const mayConnect = useMaySessionConnect()
  const accessError =
    repoAccess.kind === 'error' && isAccessDenial(repoAccess.message)
      ? repoAccess.message
      : null
  const canCreateSession =
    !accessError &&
    repoPerms.kind === 'ok' &&
    repoPerms.data.contentsWrite === true &&
    authz.kind === 'ok' &&
    !!authz.data &&
    hasEffectivePermission(authz.data, 'session:create')
  const all = state.kind === 'ok' ? state.data.sessions : []
  const mounting = sessionsMountingRepo(all, namespace, repo)
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
            Remote desktop sessions that mount a workspace of{' '}
            <code className="mono">
              {namespace}/{repo}
            </code>
            . Open a session to connect, stop, or remove it.
          </p>
        </div>
        {canCreateSession ? (
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => setCreateOpen(true)}
            >
              <ActionMonitor size={14} aria-hidden="true" className="button-label-icon" />New session
            </button>
          </div>
        ) : null}
      </header>

      {createOpen && canCreateSession ? (
        <SessionCreateModal
          onClose={() => setCreateOpen(false)}
          filterRepo={{ namespace, repo }}
        />
      ) : null}

      <StateBlock
        loading={
          repoAccess.kind === 'loading' ||
          (!accessError && state.kind === 'loading')
        }
        error={
          accessError ?? (state.kind === 'error' ? state.message : null)
        }
        errorPurpose="view sessions"
        onRetry={
          accessError
            ? undefined
            : () => {
                state.reload()
                repoAccess.reload()
              }
        }
        empty={!accessError && state.kind === 'ok' && mounting.length === 0}
        emptyMessage={
          canCreateSession
            ? 'No sessions mount a workspace of this repository yet. Use the New session button above to get started.'
            : 'No sessions mount a workspace of this repository yet.'
        }
      >
        {!accessError && state.kind === 'ok' && mounting.length > 0 && (
          <>
            <ListToolbar
              id="repo-sessions"
              sort={sort}
              search={{ value: filter, onChange: setFilter, placeholder: 'Filter by id, status or owner' }}
              meta={`${sessions.length} session${sessions.length === 1 ? '' : 's'}${filter.trim() ? ' matching' : ''}`}
            />
            <ul className="card-list">
              {slice.items.map((s) => (
                <li key={s.id} className="fav-row session-row">
                  <SessionSummaryCard session={s} />
                  <SessionRowActions session={s} mayConnect={mayConnect} onChanged={() => state.reload()} />
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
