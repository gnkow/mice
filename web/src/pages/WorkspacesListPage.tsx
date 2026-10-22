import { FileDiff, Monitor as ActionMonitor, Tags, Terminal, Trash2 as ActionTrash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MetaPills } from '../components/MetaPills'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'
import { confirmDelete } from '../lib/confirmDelete'
import { deleteWorkspace } from '../lib/oxen/api'
import { listSessions, sessionMounts, type DesktopSession } from '../lib/sessions'
import { SortControl, useListSort, type SortFields } from '../components/SortControl'
import { useFavorites } from '../lib/favorites'
import type { CatalogWorkspace } from '../lib/catalog'
import { FavoriteStar } from '../components/FavoriteStar'

const WORKSPACES_SORTS: SortFields<CatalogWorkspace> = { name: (x) => x.name || x.id, created: (x) => x.createdAt }

export function WorkspacesListPage() {
  const state = useAsync((signal) => loadCatalog(signal), [])
  const sessions = useAsync((signal) => listSessions(signal), [])
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState(params.get('q') ?? '')
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter((ws) => {
      const name = ws.name || ws.id
      const repo = `${ws.namespace}/${ws.repo}`
      return name.toLowerCase().includes(q) || 
             repo.toLowerCase().includes(q)
    })
  }, [workspaces, filter])

  const sort = useListSort('workspaces', WORKSPACES_SORTS)
  const favs = useFavorites()
  const ordered = useMemo(
    () => sort.apply(filtered, (x) => favs.has('workspace', `${x.namespace}/${x.repo}!${x.id}`)),
    [filtered, sort.apply, favs],
  )
  const slice = paginate(ordered, page, PAGE_SIZE)

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

  async function onDelete(ns: string, repo: string, id: string, label: string) {
    if (
      !(await confirmDelete({
        title: `Delete workspace ${label}`,
        detail:
          'Staged changes in this workspace will be discarded. Committed history on the branch is unaffected.',
        confirmWord: label,
      }))
    ) {
      return
    }
    setBusyId(id)
    setError(null)
    try {
      await deleteWorkspace(ns, repo, id)
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Workspaces</h1>
          <p className="lede">
            Work with your data on the server without downloading everything locally.
          </p>
        </div>
      </div>

      <div className="ns-toolbar">
        <SortControl id="workspaces" sort={sort} />
        <div className="ns-search-field">
          <label className="ns-search-label" htmlFor="workspace-filter">
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
              id="workspace-filter"
              type="search"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Filter by name, repository, or branch"
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
            {filtered.length} workspace{filtered.length === 1 ? '' : 's'}
            {filter.trim() ? ' matching' : ''}
          </p>
        )}
      </div>

      {error && <p className="flash flash-error" role="status">{error}</p>}

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && filtered.length === 0}
        emptyMessage={
          filter.trim()
            ? `No workspaces match "${filter.trim()}".`
            : "No workspaces yet. Open a repository and create one from its Workspaces tab."
        }
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
                        <div className="workspace-name-cell">
                          <FavoriteStar type="workspace" id={`${ws.namespace}/${ws.repo}!${ws.id}`} label={label} />
                          <Link to={href} className="workspace-name-link">
                            {label}
                          </Link>
                          <span className="mono muted small" title={ws.id}>
                            {ws.id.slice(0, 8)}
                          </span>
                        </div>
                        <MetaPills type="workspace" id={`${ws.namespace}/${ws.repo}!${ws.id}`} />
                      </td>
                      <td className="muted small">
                        <Link
                          to={`/n/${encodeURIComponent(ws.namespace)}/r/${encodeURIComponent(ws.repo)}`}
                          className="workspace-commit-link"
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
                          <span className="muted small">No sessions</span>
                        )}
                      </td>
                      <td className="muted small">—</td>
                      <td className="workspaces-col-actions">
                        <div className="workspace-row-actions">
                          <Link
                            className="icon-round"
                            to={`${href}#changes`}
                            aria-label={`Changes for ${label}`}
                            title={`Changes for ${label}`}
                          >
                            <FileDiff size={14} aria-hidden />
                          </Link>
                          <Link
                            className="icon-round"
                            to={`${href}#jobs`}
                            aria-label={`Jobs for ${label}`}
                            title={`Jobs for ${label}`}
                          >
                            <Terminal size={14} aria-hidden />
                          </Link>
                          <Link
                            className="icon-round"
                            to={`${href}#sessions`}
                            aria-label={`Sessions for ${label}`}
                            title={`Sessions for ${label}`}
                          >
                            <ActionMonitor size={14} aria-hidden />
                          </Link>
                          <Link
                            className="icon-round"
                            to={`${href}#metadata`}
                            aria-label={`Metadata for ${label}`}
                            title={`Metadata for ${label}`}
                          >
                            <Tags size={14} aria-hidden />
                          </Link>
                          <button
                            type="button"
                            className="icon-round workspace-delete"
                            disabled={busyId === ws.id}
                            title={`Delete ${label}`}
                            aria-label={`Delete workspace ${label}`}
                            onClick={() => void onDelete(ws.namespace, ws.repo, ws.id, label)}
                          >
                            <ActionTrash2 size={14} aria-hidden />
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

    </main>
  )
}
