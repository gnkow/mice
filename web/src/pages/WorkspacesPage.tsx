import { Layers as ActionLayers, X as ActionX, FileDiff, Tags } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BranchesSubNav } from '../components/BranchesSubNav'
import { FavoriteStar } from '../components/FavoriteStar'
import { ListToolbar } from '../components/ListToolbar'
import { Modal } from '../components/Modal'
import { useListSort, type SortFields } from '../components/SortControl'
import { useFavorites } from '../lib/favorites'
import { MetaPills } from '../components/MetaPills'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { confirmDelete } from '../lib/confirmDelete'
import { resolveDefaultBranch } from '../lib/lastBranch'
import {
  createWorkspace,
  deleteWorkspace,
  listBranches,
  listWorkspaces,
} from '../lib/oxen/api'
import { OxenApiError, type Workspace } from '../lib/oxen/types'
import { formatRelativeTime } from '../lib/time'

const WS_SORTS: SortFields<Workspace> = { name: (w) => w.name || w.id, created: (w) => w.created_at }

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M6.5 1.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V3h3.25a.75.75 0 0 1 0 1.5H13v8.25A1.75 1.75 0 0 1 11.25 14.5h-6.5A1.75 1.75 0 0 1 3 12.75V4.5h.25A.75.75 0 0 1 3.25 3H6.5V1.75Zm-2 2.75v8.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V4.5H4.5Zm2 1.75a.75.75 0 0 1 1.5 0v5a.75.75 0 0 1-1.5 0v-5Zm3 0a.75.75 0 0 1 1.5 0v5a.75.75 0 0 1-1.5 0v-5Z"
      />
    </svg>
  )
}

export function WorkspacesPage() {
  const { namespace = '', repo = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const workspaces = useAsync(
    (signal) => listWorkspaces(namespace, repo, signal),
    [namespace, repo],
  )
  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )

  const [filter, setFilter] = useState('')
  const sort = useListSort('repo-stages', WS_SORTS)
  const favs = useFavorites()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (params.get('new') !== '1') return
    setError(null)
    setCreateOpen(true)
    const next = new URLSearchParams(params)
    next.delete('new')
    setParams(next, { replace: true })
  }, [params, setParams])

  const branchNames = useMemo(
    () =>
      branches.kind === 'ok'
        ? branches.data.branches.map((b) => b.name)
        : [],
    [branches],
  )
  const defaultBranch = useMemo(
    () => resolveDefaultBranch(branchNames, namespace, repo),
    [branchNames, namespace, repo],
  )

  useEffect(() => {
    if (branchNames.length === 0) return
    setBranch((prev) => (branchNames.includes(prev) ? prev : defaultBranch))
  }, [branchNames, defaultBranch])

  const list = workspaces.kind === 'ok' ? workspaces.data.workspaces : []
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return list
    return list.filter((ws) => {
      const label = (ws.name || ws.id).toLowerCase()
      return (
        label.includes(needle) ||
        ws.id.toLowerCase().includes(needle) ||
        ws.commit.message.toLowerCase().includes(needle)
      )
    })
  }, [list, filter])
  const ordered = useMemo(
    () => sort.apply(filtered, (ws) => favs.has('stage', `${namespace}/${repo}!${ws.id}`)),
    [filtered, sort.apply, favs, namespace, repo],
  )

  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await createWorkspace(
        namespace,
        repo,
        branch || defaultBranch,
        name.trim() || 'stage',
      )
      setCreateOpen(false)
      setName('')
      navigate(`${base}/stages/${encodeURIComponent(res.workspace.id)}`)
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Create failed',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteOne(id: string, label: string) {
    if (
      !(await confirmDelete({
        title: `Delete stage ${label}`,
        detail:
          'Staged changes in this stage will be discarded. Committed history on the branch is unaffected.',
        confirmWord: label,
      }))
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteWorkspace(namespace, repo, id)
      workspaces.reload()
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Delete failed',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <BranchesSubNav />
      <div className="page-head">
        <div>
          <h1>Stages</h1>
          <p className="lede">
            Make changes on the server without downloading the entire repository.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setError(null)
              setCreateOpen(true)
            }}
          >
            <ActionLayers size={14} aria-hidden="true" className="button-label-icon" />New stage
          </button>
        </div>
      </div>

      <ListToolbar
        id="stages"
        sort={sort}
        search={{ value: filter, onChange: setFilter, placeholder: 'Filter stages…', disabled: workspaces.kind !== 'ok' }}
      />

      <StateBlock
        loading={workspaces.kind === 'loading'}
        error={workspaces.kind === 'error' ? workspaces.message : null}
        empty={workspaces.kind === 'ok' && list.length === 0}
        emptyMessage="No stages yet. Create one to stage changes remotely."
      >
        {workspaces.kind === 'ok' && (
          <div className="table-container">
            {filtered.length === 0 ? (
              <p className="muted">No matching stages.</p>
            ) : (
              <table className="table workspaces-table">
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Base</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((ws) => {
                    const label = ws.name || ws.id.slice(0, 8)
                    const href = `${base}/stages/${encodeURIComponent(ws.id)}`
                    return (
                      <tr key={ws.id} data-workspace={ws.id}>
                        <td>
                          <div className="workspace-name-cell">
                            <Link className="workspace-name-link" to={href}>
                              {label}
                            </Link>
                            <FavoriteStar type="stage" id={`${namespace}/${repo}!${ws.id}`} label={label} />
                            <span className="mono muted small" title={ws.id}>
                              {ws.id.slice(0, 8)}
                            </span>
                          </div>
                          <MetaPills type="workspace" id={`${namespace}/${repo}!${ws.id}`} />
                        </td>
                        <td>
                          <div className="workspace-base-cell">
                            <Link
                              className="mono workspace-commit-link"
                              title={ws.commit.id}
                              to={`${base}/commits/${encodeURIComponent(ws.commit.id)}`}
                            >
                              {ws.commit.id.slice(0, 8)}
                            </Link>
                            <span
                              className="muted small workspace-base-msg"
                              title={ws.commit.message}
                            >
                              {ws.commit.message}
                            </span>
                          </div>
                        </td>
                        <td className="muted small">
                          {ws.created_at
                            ? formatRelativeTime(ws.created_at)
                            : '—'}
                        </td>
                        <td className="workspaces-col-actions">
                          <div className="workspace-row-actions">
                            <Link
                              className="icon-round"
                              to={`${href}#changes`}
                              aria-label={`Changes in ${label}`}
                              title={`Changes in ${label}`}
                            >
                              <FileDiff size={14} aria-hidden />
                            </Link>
                            <Link
                              className="icon-round"
                              to={`${href}#metadata`}
                              aria-label={`Metadata for ${label}`}
                              title={`Metadata for ${label}`}
                            >
                              <Tags size={14} aria-hidden />
                            </Link>                            <button
                              type="button"
                              className="icon-round workspace-delete"
                              disabled={busy}
                              title={`Delete ${label}`}
                              aria-label={`Delete stage ${label}`}
                              onClick={() => void onDeleteOne(ws.id, label)}
                            >
                              <TrashIcon />
                            </button>

                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </StateBlock>

      {createOpen && (
        <Modal title="New stage" onClose={() => setCreateOpen(false)}>
          <form className="form" onSubmit={onCreate}>
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-stage"
                autoFocus
              />
            </label>
            <label>
              Base branch
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                aria-label="Base branch"
              >
                {branchNames.length > 0 ? (
                  branchNames.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))
                ) : (
                  <option value={branch}>{branch}</option>
                )}
              </select>
            </label>
            <div className="btn-row modal-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setCreateOpen(false)}
              >
                <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy}>
                <ActionLayers size={14} aria-hidden="true" className="button-label-icon" />{busy ? 'Creating…' : 'Create stage'}
              </button>
            </div>
            {error && <p className="flash flash-error" role="status">{error}</p>}
          </form>
        </Modal>
      )}


      {!createOpen && error && <p className="flash flash-error" role="status">{error}</p>}
    </main>
  )
}
