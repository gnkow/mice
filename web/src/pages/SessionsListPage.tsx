import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { SessionCreateModal } from '../components/SessionCreateModal'
import { SessionSummaryCard } from '../components/SessionSummaryCard'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import { listSessions } from '../lib/sessions'

export function SessionsListPage() {
  const state = useAsync((signal) => listSessions(signal), [])
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  const [params, setParams] = useSearchParams()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const sessions = state.kind === 'ok' ? state.data.sessions : []
  const slice = paginate(sessions, page, PAGE_SIZE)
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

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p className="lede">
            Dedicated Linux desktops — exclusive to you. Mount zero or more
            workspaces to work with your data.
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
            New session
          </button>
        </div>
      </div>

      {createOpen && <SessionCreateModal onClose={() => setCreateOpen(false)} />}

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && sessions.length === 0}
        emptyMessage={<>No sessions yet. Create one to provision a desktop.</>}
      >
        {state.kind === 'ok' && (
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
