import { StatusPill } from '../components/StatusPill'
import { Monitor as ActionSessions, Terminal as ActionJobs, Layers as ActionLayers, RefreshCw as ActionRefresh, Trash2 as ActionTrash2, X as ActionX } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CommitSelector } from '../components/CommitSelector'
import { ListToolbar } from '../components/ListToolbar'
import { Modal } from '../components/Modal'
import { useListSort, type SortFields } from '../components/SortControl'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'
import { confirmDelete } from '../lib/confirmDelete'
import { resolveDefaultBranch } from '../lib/lastBranch'
import { listBranches } from '../lib/oxen/api'
import { formatBytes } from '../lib/oxen/client'
import { formatRelativeTime } from '../lib/time'
import {
  createMiceWorkspace,
  deleteMiceWorkspace,
  listMiceWorkspaces,
  retryMiceWorkspace,
  type MiceWorkspace,
} from '../lib/workspaces'

const WS_SORTS: SortFields<MiceWorkspace> = { name: (w) => w.name || w.id, created: (w) => w.created_at }

function statusText(w: MiceWorkspace): string {
  if (w.status === 'preparing') {
    const p = w.progress
    if (p && p.files_total > 0) return `preparing ${p.phase} ${p.files_done}/${p.files_total}`
    return `preparing${p ? ` ${p.phase}` : ''}`
  }
  return w.status
}

function inUse(w: MiceWorkspace): boolean {
  return (w.session_count ?? 0) > 0 || (w.leases?.length ?? 0) > 0
}

function changeSummary(w: MiceWorkspace): string {
  const { added, modified, removed } = w.change_counts
  if (added + modified + removed === 0) return 'No changes'
  return `+${added} ~${modified} −${removed}`
}

export function WorkspacesHubPage() {
  const { namespace: scopeNs, repo: scopeRepo } = useParams()
  const scoped = Boolean(scopeNs && scopeRepo)
  const list = useAsync(
    (signal) => listMiceWorkspaces(scoped ? { namespace: scopeNs, repo: scopeRepo } : undefined, signal),
    [scopeNs, scopeRepo, scoped],
  )
  const catalog = useAsync((signal) => loadCatalog(signal), [])
  const [params, setParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const all = list.kind === 'ok' ? list.data.workspaces : []
  const [filter, setFilter] = useState('')
  const sort = useListSort('workspaces', WS_SORTS)
  const workspaces = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const matching = all.filter(
      (w) =>
        (!needle ||
          [w.name, w.id, w.namespace, w.repo, w.branch].some((v) => (v ?? '').toLowerCase().includes(needle))),
    )
    return sort.apply(matching, () => false)
  }, [all, filter, sort.apply])
  const anyPreparing = all.some((w) => w.status === 'preparing')

  useEffect(() => {
    if (!anyPreparing) return
    const t = setInterval(() => list.reload(), 2000)
    return () => clearInterval(t)
  }, [anyPreparing, list])

  useEffect(() => {
    if (params.get('new') !== '1') return
    setCreateOpen(true)
    const next = new URLSearchParams(params)
    next.delete('new')
    setParams(next, { replace: true })
  }, [params, setParams])

  async function onDelete(w: MiceWorkspace) {
    if (
      !(await confirmDelete({
        title: `Delete workspace ${w.name || w.id}`,
        detail: 'All changes in this workspace will be discarded. The repository is unaffected.',
        confirmWord: w.name || w.id,
      }))
    ) {
      return
    }
    setBusyId(w.id)
    setError(null)
    try {
      await deleteMiceWorkspace(w.id)
      list.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  async function onRetry(w: MiceWorkspace) {
    setBusyId(w.id)
    setError(null)
    try {
      await retryMiceWorkspace(w.id)
      list.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
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
            Writable working trees over a shared checkout of a repository, for sessions and cluster jobs.
          </p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
            <ActionLayers size={14} aria-hidden="true" className="button-label-icon" />New workspace
          </button>
        </div>
      </div>

      {error && <p className="flash flash-error" role="status">{error}</p>}

      <StateBlock
        loading={list.kind === 'loading'}
        error={list.kind === 'error' ? list.message : null}
        onRetry={() => list.reload()}
        empty={list.kind === 'ok' && all.length === 0}
        emptyMessage={all.length === 0 ? 'No workspaces yet.' : 'No matching workspaces.'}
      >
        <ListToolbar
          id="workspaces"
          sort={sort}
          search={{ value: filter, onChange: setFilter, placeholder: 'Filter by name, id, repo or branch' }}
          meta={`${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}${filter.trim() ? ' matching' : ''}`}
        />
        {workspaces.length === 0 && <p className="muted">No matching workspaces.</p>}
        <div className="table-container">
          <table className="table workspaces-table">
            <thead>
              <tr>
                <th scope="col">Workspace</th>
                <th scope="col">Repository</th>
                <th scope="col">Base</th>
                <th scope="col">Status</th>
                <th scope="col">Changes</th>
                <th scope="col">Created</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id} data-workspace={w.id}>
                  <td>
                    <Link
                      className="workspace-name-link"
                      to={`/n/${encodeURIComponent(w.namespace)}/r/${encodeURIComponent(w.repo)}/workspaces/${encodeURIComponent(w.id)}`}
                    >
                      {w.name || w.id}
                    </Link>{' '}
                    <span className="mono muted small">{w.id}</span>
                  </td>
                  <td className="muted small">
                    <Link to={`/n/${encodeURIComponent(w.namespace)}/r/${encodeURIComponent(w.repo)}`}>
                      {w.namespace}/{w.repo}
                    </Link>
                  </td>
                  <td className="muted small">
                    {w.branch ?? 'commit'}
                    {w.base_commit ? <span className="mono"> @ {w.base_commit.slice(0, 8)}</span> : null}
                    {w.behind ? <span className="pill"> behind</span> : null}
                  </td>
                  <td className="small" title={w.last_error ?? undefined}>
                    <StatusPill status={w.status} label={statusText(w)} />
                    {w.writer ? (
                      <span className="pill warn" title={`Writer: ${w.writer.label || w.writer.id}`}>
                        {' '}writer: {w.writer.label || w.writer.kind}
                      </span>
                    ) : null}
                    {w.last_error ? <div className="error small">{w.last_error}</div> : null}
                  </td>
                  <td className="muted small">
                    {changeSummary(w)}
                    {w.upper_bytes > 0 ? ` · ${formatBytes(w.upper_bytes)}` : ''}
                  </td>
                  <td className="muted small">{formatRelativeTime(w.created_at)}</td>
                  <td className="workspaces-col-actions">
                    <div className="workspace-row-actions">
                      <Link
                        className="icon-round"
                        title={`Jobs of ${w.name || w.id}`}
                        aria-label={`Jobs of workspace ${w.name || w.id}`}
                        to={`/n/${encodeURIComponent(w.namespace)}/r/${encodeURIComponent(w.repo)}/workspaces/${encodeURIComponent(w.id)}?tab=jobs`}
                      >
                        <ActionJobs size={14} aria-hidden />
                      </Link>
                      <Link
                        className="icon-round"
                        title={`Sessions of ${w.name || w.id}`}
                        aria-label={`Sessions of workspace ${w.name || w.id}`}
                        to={`/n/${encodeURIComponent(w.namespace)}/r/${encodeURIComponent(w.repo)}/workspaces/${encodeURIComponent(w.id)}?tab=sessions`}
                      >
                        <ActionSessions size={14} aria-hidden />
                      </Link>
                      {w.status === 'error' ? (
                        <button
                          type="button"
                          className="icon-round"
                          disabled={busyId === w.id}
                          title={`Retry ${w.name || w.id}`}
                          aria-label={`Retry workspace ${w.name || w.id}`}
                          onClick={() => void onRetry(w)}
                        >
                          <ActionRefresh size={14} aria-hidden />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="icon-round workspace-delete"
                        disabled={busyId === w.id || inUse(w)}
                        title={inUse(w) ? 'In use by a session or job — detach it first' : `Delete ${w.name || w.id}`}
                        aria-label={`Delete workspace ${w.name || w.id}`}
                        onClick={() => void onDelete(w)}
                      >
                        <ActionTrash2 size={14} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </StateBlock>

      {createOpen && (
        <CreateWorkspaceModal
          scoped={scoped}
          repos={
            scoped
              ? [{ namespace: scopeNs!, name: scopeRepo! }]
              : catalog.kind === 'ok'
                ? catalog.data.repositories
                : []
          }
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            list.reload()
          }}
        />
      )}
    </main>
  )
}

function CreateWorkspaceModal({
  scoped,
  repos,
  onClose,
  onCreated,
}: {
  scoped: boolean
  repos: { namespace: string; name: string }[]
  onClose: () => void
  onCreated: () => void
}) {
  const [repoKey, setRepoKey] = useState('')
  const [branch, setBranch] = useState('')
  const [baseKind, setBaseKind] = useState<'branch' | 'commit'>('branch')
  const [commit, setCommit] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = repoKey || (repos[0] ? `${repos[0].namespace}/${repos[0].name}` : '')
  const [namespace = '', repo = ''] = active.split('/')
  const branches = useAsync(
    (signal) => (namespace && repo ? listBranches(namespace, repo, signal) : Promise.resolve(null)),
    [namespace, repo],
  )
  const branchNames = useMemo(
    () => (branches.kind === 'ok' && branches.data ? branches.data.branches.map((b) => b.name) : []),
    [branches],
  )
  const activeBranch = branchNames.includes(branch)
    ? branch
    : resolveDefaultBranch(branchNames, namespace, repo)
  const trimmed = name.trim()
  const nameValid = trimmed.length === 0 || trimmed.length >= 2
  const canCreate = !busy && !!namespace && nameValid && (baseKind === 'branch' ? !!activeBranch : !!commit)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createMiceWorkspace({
        namespace,
        repo,
        name: trimmed || undefined,
        source: baseKind === 'branch' ? { branch: activeBranch } : { commit },
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="New workspace" onClose={onClose}>
      <form className="form" onSubmit={onSubmit}>
        <label>
          Workspace name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            name="workspace-name"
            placeholder="Optional — w_id-branch-commit_short"
            aria-invalid={!nameValid}
          />
        </label>
        {!nameValid && <p className="field-hint error-text">at least 2 characters</p>}
        {!scoped && (
          <label>
            Repository
            <select value={active} onChange={(e) => { setRepoKey(e.target.value); setCommit('') }} disabled={busy}>
              {repos.map((r) => (
                <option key={`${r.namespace}/${r.name}`} value={`${r.namespace}/${r.name}`}>
                  {r.namespace}/{r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Source type
          <select
            value={baseKind}
            onChange={(e) => {
              setBaseKind(e.target.value as 'branch' | 'commit')
              setCommit('')
            }}
            aria-label="Source type"
          >
            <option value="branch">Branch</option>
            <option value="commit">Commit</option>
          </select>
        </label>
        <label>
          {baseKind === 'commit' ? 'Branch to pick the commit from' : 'Source branch'}
          <select
            value={activeBranch}
            onChange={(e) => {
              setBranch(e.target.value)
              setCommit('')
            }}
            required
            aria-label={baseKind === 'commit' ? 'Commit branch' : 'Source branch'}
          >
            {branchNames.length > 0 ? (
              branchNames.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))
            ) : (
              <option value={activeBranch}>{activeBranch}</option>
            )}
          </select>
        </label>
        {baseKind === 'commit' && activeBranch && (
          <CommitSelector
            namespace={namespace}
            repo={repo}
            branch={activeBranch}
            value={commit}
            onChange={setCommit}
            label="Commit"
          />
        )}
        <div className="btn-row modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
          </button>
          <button className="btn primary" type="submit" disabled={!canCreate}>
            <ActionLayers size={14} aria-hidden="true" className="button-label-icon" />
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  )
}
