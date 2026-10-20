import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { SessionCreateModal } from '../components/SessionCreateModal'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'
import { listSessions, sessionMounts, type DesktopSession } from '../lib/sessions'

export function WorkspacesListPage() {
  const state = useAsync((signal) => loadCatalog(signal), [])
  const sessions = useAsync((signal) => listSessions(signal), [])
  const [params, setParams] = useSearchParams()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const [sessionCreateWorkspace, setSessionCreateWorkspace] = useState<{
    namespace: string
    repo: string
    workspaceId: string
  } | null>(null)
  
  const workspaces = state.kind === 'ok' ? state.data.workspaces : []
  const sessionsList = sessions.kind === 'ok' ? sessions.data.sessions : []

  // Build a map from workspace_id to sessions that mount it
  const workspaceToSessions = useMemo(() => {
    const map = new Map<string, DesktopSession[]>()
    for (const session of sessionsList) {
      const mounts = sessionMounts(session)
      for (const mount of mounts) {
        if (mount.workspace_id) {
          const key = `${mount.namespace}/${mount.repo}/${mount.workspace_id}`
          const arr = map.get(key) || []
          arr.push(session)
          map.set(key, arr)
        }
      }
    }
    return map
  }, [sessionsList])

  const slice = paginate(workspaces, page, PAGE_SIZE)

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
          <h1>Workspaces</h1>
          <p className="lede">
            Remote staging workspaces across all repositories on this server.
          </p>
        </div>
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && workspaces.length === 0}
        emptyMessage="No workspaces yet. Open a repository and create one from its Workspaces tab."
      >
        {state.kind === 'ok' && (
          <div className="table-container">
            <table className="table workspaces-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Repository</th>
                  <th>Branch</th>
                  <th>Sessions</th>
                  <th>Created</th>
                  <th className="workspaces-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {slice.items.map((ws) => {
                  const key = `${ws.namespace}/${ws.repo}/${ws.id}`
                  const mountedSessions = workspaceToSessions.get(key) || []
                  const label = ws.name || ws.id.slice(0, 8)
                  const href = `/n/${encodeURIComponent(ws.namespace)}/r/${encodeURIComponent(ws.repo)}/workspaces/${encodeURIComponent(ws.id)}`
                  return (
                    <tr key={key}>
                      <td>
                        <Link to={href} className="workspace-link">
                          {label}
                        </Link>
                      </td>
                      <td className="muted small">
                        <Link
                          to={`/n/${encodeURIComponent(ws.namespace)}/r/${encodeURIComponent(ws.repo)}`}
                          className="repo-link"
                        >
                          {ws.namespace}/{ws.repo}
                        </Link>
                      </td>
                      <td className="muted small">—</td>
                      <td className="workspace-sessions-cell">
                        {mountedSessions.length > 0 ? (
                          <div className="workspace-sessions-list">
                            {mountedSessions.slice(0, 3).map((s) => (
                              <Link
                                key={s.id}
                                to={`/sessions/${encodeURIComponent(s.id)}`}
                                className="workspace-session-link"
                              >
                                {s.template_id || s.id.slice(0, 12)}
                              </Link>
                            ))}
                            {mountedSessions.length > 3 && (
                              <span className="muted small">
                                +{mountedSessions.length - 3} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted small">—</td>
                      <td className="workspaces-col-actions">
                        <div className="workspace-row-actions">
                          <Link className="btn ghost workspace-open-btn" to={href}>
                            Open
                          </Link>
                          <button
                            type="button"
                            className="btn ghost small workspace-new-session-btn"
                            title={`Create session for ${label}`}
                            onClick={() =>
                              setSessionCreateWorkspace({
                                namespace: ws.namespace,
                                repo: ws.repo,
                                workspaceId: ws.id,
                              })
                            }
                          >
                            New session
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {state.kind === 'ok' && workspaces.length > 0 && (
          <Pagination
            page={slice.page}
            pageCount={slice.pageCount}
            onPageChange={goPage}
            label="Workspaces pages"
            total={slice.total}
          />
        )}
      </StateBlock>

      {sessionCreateWorkspace && (
        <SessionCreateModal
          onClose={() => setSessionCreateWorkspace(null)}
          preselectedWorkspace={sessionCreateWorkspace}
        />
      )}
    </main>
  )
}
