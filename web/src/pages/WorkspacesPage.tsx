import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Modal } from '../components/Modal'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { confirmDelete } from '../lib/confirmDelete'
import { resolveDefaultBranch } from '../lib/lastBranch'
import {
  clearWorkspaces,
  createWorkspace,
  deleteWorkspace,
  listBranches,
  listWorkspaces,
} from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'
import { formatRelativeTime } from '../lib/time'

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
  const workspaces = useAsync(
    (signal) => listWorkspaces(namespace, repo, signal),
    [namespace, repo],
  )
  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )

  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        name.trim() || 'workspace',
      )
      setCreateOpen(false)
      setName('')
      navigate(`${base}/workspaces/${encodeURIComponent(res.workspace.id)}`)
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
        title: `Delete workspace ${label}`,
        detail:
          'Staged changes in this workspace will be discarded. Committed history on the branch is unaffected.',
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

  async function onClear() {
    if (
      !(await confirmDelete({
        title: `Delete all workspaces in ${namespace}/${repo}`,
        detail:
          'Every workspace for this repository will be removed and all staged (uncommitted) changes discarded.',
        confirmWord: 'DELETE ALL',
      }))
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await clearWorkspaces(namespace, repo)
      workspaces.reload()
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Clear failed',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page workspaces-page">
      <div className="workspaces-page-head">
        <div>
          <h1 className="workspaces-title">Workspaces</h1>
          <p className="workspaces-subtitle muted">
            Stage and commit changes on the server without a full local clone.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn ghost danger-text"
            disabled={busy || list.length === 0}
            onClick={() => void onClear()}
          >
            Clear all
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setError(null)
              setCreateOpen(true)
            }}
          >
            New workspace
          </button>
        </div>
      </div>

      <div className="workspaces-toolbar">
        <label>
          <span className="sr-only">Filter workspaces</span>
          <input
            type="search"
            className="workspaces-filter"
            placeholder="Filter workspaces…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={workspaces.kind !== 'ok'}
          />
        </label>
      </div>

      <StateBlock
        loading={workspaces.kind === 'loading'}
        error={workspaces.kind === 'error' ? workspaces.message : null}
        empty={workspaces.kind === 'ok' && list.length === 0}
        emptyMessage="No workspaces yet. Create one to stage remote changes."
      >
        {workspaces.kind === 'ok' && (
          <div className="workspaces-table-wrap">
            {filtered.length === 0 ? (
              <p className="muted">No matching workspaces.</p>
            ) : (
              <table className="workspaces-table">
                <thead>
                  <tr>
                    <th scope="col">Workspace</th>
                    <th scope="col">Base</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ws) => {
                    const label = ws.name || ws.id.slice(0, 8)
                    const href = `${base}/workspaces/${encodeURIComponent(ws.id)}`
                    return (
                      <tr key={ws.id} data-workspace={ws.id}>
                        <td>
                          <div className="workspace-name-cell">
                            <Link className="workspace-name-link" to={href}>
                              {label}
                            </Link>
                            <span className="mono muted small" title={ws.id}>
                              {ws.id.slice(0, 8)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="workspace-base-cell">
                            <code className="mono" title={ws.commit.id}>
                              {ws.commit.id.slice(0, 8)}
                            </code>
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
                            <Link className="btn ghost workspace-open-btn" to={href}>
                              Open
                            </Link>
                            <button
                              type="button"
                              className="icon-round workspace-delete"
                              disabled={busy}
                              title={`Delete ${label}`}
                              aria-label={`Delete workspace ${label}`}
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
        <Modal title="New workspace" onClose={() => setCreateOpen(false)}>
          <form className="form" onSubmit={onCreate}>
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-workspace"
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
                Cancel
              </button>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        </Modal>
      )}

      {!createOpen && error && <p className="error">{error}</p>}
    </main>
  )
}
