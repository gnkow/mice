import { FileText as ActionFileText, GitCommitHorizontal as ActionGitCommitHorizontal, Monitor as ActionMonitor, RefreshCw as ActionRefreshCw, Search as ActionSearch, Trash2 as ActionTrash2, Undo2 as ActionUndo2, Upload as ActionUpload, X as ActionX } from 'lucide-react'
import { FileDiff, Tags, Terminal, type LucideIcon } from 'lucide-react'
import { MetaBody } from '../components/MetaPanel'
import { SessionCreateModal } from '../components/SessionCreateModal'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { confirmDelete } from '../lib/confirmDelete'
import { resolveDefaultBranch } from '../lib/lastBranch'
import {
  checkWorkspaceMergeable,
  deleteWorkspace,
  downloadWorkspaceFileText,
  getWorkspace,
  listBranches,
  listWorkspaceChanges,
  mergeWorkspace,
  stageWorkspaceRemovals,
  unstageWorkspaceFiles,
  uploadToWorkspace,
} from '../lib/oxen/api'
import { formatBytes } from '../lib/oxen/client'
import { OxenApiError, type MetadataEntry } from '../lib/oxen/types'
import {
  getMountDiff,
  listSessions,
  sessionMounts,
  syncSessionMount,
} from '../lib/sessions'
import { formatRelativeTime } from '../lib/time'

type WorkspaceTab = 'changes' | 'jobs' | 'sessions' | 'metadata'
type StagedKind = 'added' | 'modified' | 'removed'

const TABS: { id: WorkspaceTab; label: string; icon: LucideIcon }[] = [
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'jobs', label: 'Jobs', icon: Terminal },
  { id: 'sessions', label: 'Sessions', icon: ActionMonitor },
  { id: 'metadata', label: 'Metadata', icon: Tags },
]

function tabFromHash(hash: string): WorkspaceTab {
  const id = hash.replace(/^#/, '')
  return TABS.some((t) => t.id === id) ? (id as WorkspaceTab) : 'changes'
}

const STAGED_KIND_LABEL: Record<StagedKind, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
}

function EntryList({
  kind,
  entries,
  onUnstage,
  onPreview,
  busy,
}: {
  kind: StagedKind
  entries: MetadataEntry[]
  onUnstage: (path: string) => void
  onPreview: (path: string) => void
  busy: boolean
}) {
  if (entries.length === 0) return null
  return (
    <div className={`workspace-entry-group is-${kind}`}>
      <div className="workspace-entry-group-head">
        <h3 className="workspace-entry-group-title">
          {STAGED_KIND_LABEL[kind]}
        </h3>
        <span className="muted small workspace-entry-count">
          {entries.length}
        </span>
      </div>
      <ul className="workspace-entry-list">
        {entries.map((e) => {
          const name = e.filename.split('/').pop() || e.filename
          const dir = e.filename.includes('/')
            ? e.filename.slice(0, e.filename.lastIndexOf('/'))
            : null
          return (
            <li key={e.filename} className="workspace-entry-row">
              <span
                className={`workspace-entry-badge is-${kind}`}
                aria-hidden
              />
              <div className="workspace-entry-main">
                <code className="mono workspace-entry-name" title={e.filename}>
                  {name}
                </code>
                {dir && (
                  <span className="muted small workspace-entry-dir">{dir}</span>
                )}
              </div>
              {!e.is_dir && e.size > 0 && (
                <span className="muted small workspace-entry-size">
                  {formatBytes(e.size)}
                </span>
              )}
              <span className="workspace-entry-actions">
                {!e.is_dir && kind !== 'removed' && (
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={busy}
                    onClick={() => onPreview(e.filename)}
                  >
                    <ActionFileText size={14} aria-hidden="true" className="button-label-icon" />Preview
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => onUnstage(e.filename)}
                >
                  <ActionUndo2 size={14} aria-hidden="true" className="button-label-icon" />Unstage
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function WorkspacePage() {
  const { namespace = '', repo = '', workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  const detail = useAsync(
    (signal) => getWorkspace(namespace, repo, workspaceId, signal),
    [namespace, repo, workspaceId],
  )

  const [changesPath, setChangesPath] = useState('')
  const [changesPathApplied, setChangesPathApplied] = useState('')
  const { hash } = useLocation()
  const [tab, setTab] = useState<WorkspaceTab>(() => tabFromHash(hash))

  useEffect(() => {
    setTab(tabFromHash(hash))
  }, [hash])

  const changes = useAsync(
    (signal) =>
      listWorkspaceChanges(
        namespace,
        repo,
        workspaceId,
        signal,
        changesPathApplied.trim() || undefined,
      ),
    [namespace, repo, workspaceId, changesPathApplied],
  )
  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )

  const [directory, setDirectory] = useState('')
  const [removePath, setRemovePath] = useState('')
  const [mergeBranch, setMergeBranch] = useState('main')
  const [message, setMessage] = useState('Workspace commit via Mice')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)

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
    setMergeBranch((prev) =>
      branchNames.includes(prev) ? prev : defaultBranch,
    )
  }, [branchNames, defaultBranch])

  const mergeable = useAsync(
    (signal) =>
      checkWorkspaceMergeable(
        namespace,
        repo,
        workspaceId,
        mergeBranch,
        signal,
      ),
    [namespace, repo, workspaceId, mergeBranch],
  )

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await action()
      changes.reload()
      detail.reload()
      mergeable.reload()
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Action failed',
      )
    } finally {
      setBusy(false)
    }
  }

  function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('file') as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    void run(async () => {
      const res = await uploadToWorkspace(
        namespace,
        repo,
        workspaceId,
        directory,
        file,
      )
      setInfo(`Staged ${res.paths?.join(', ') ?? file.name}`)
      form.reset()
      setTab('changes')
    })
  }

  function onRemove(e: FormEvent) {
    e.preventDefault()
    const path = removePath.trim()
    if (!path) return
    void run(async () => {
      await stageWorkspaceRemovals(namespace, repo, workspaceId, [path])
      setRemovePath('')
      setInfo(`Staged removal of ${path}`)
      setTab('changes')
    })
  }

  function onUnstage(path: string) {
    void run(async () => {
      await unstageWorkspaceFiles(namespace, repo, workspaceId, [path])
      if (previewPath === path) {
        setPreviewPath(null)
        setPreviewText(null)
      }
    })
  }

  function onPreview(path: string) {
    setBusy(true)
    setError(null)
    setPreviewPath(path)
    setPreviewText(null)
    void (async () => {
      try {
        const text = await downloadWorkspaceFileText(
          namespace,
          repo,
          workspaceId,
          path,
        )
        setPreviewText(text)
      } catch (err) {
        setPreviewText(null)
        setError(
          err instanceof OxenApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Preview failed',
        )
      } finally {
        setBusy(false)
      }
    })()
  }

  function onMerge(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const res = await mergeWorkspace(
        namespace,
        repo,
        workspaceId,
        mergeBranch,
        message,
      )
      setInfo(`Committed ${res.commit.id.slice(0, 8)}: ${res.commit.message}`)
    })
  }

  async function onDelete() {
    const label =
      detail.kind === 'ok'
        ? detail.data.workspace.name || workspaceId.slice(0, 8)
        : workspaceId.slice(0, 8)
    if (
      !(await confirmDelete({
        title: `Delete workspace ${label}`,
        detail:
          'Staged changes in this workspace will be discarded. Committed history on the branch is unaffected.',
        confirmWord: label,
      })
    )) {
      return
    }
    void run(async () => {
      await deleteWorkspace(namespace, repo, workspaceId)
      navigate(`${base}/workspaces`)
    })
  }

  const ws = detail.kind === 'ok' ? detail.data.workspace : null
  const staged = changes.kind === 'ok' ? changes.data.staged : null
  const stagedCount =
    staged == null
      ? 0
      : staged.added_files.entries.length +
        staged.modified_files.entries.length +
        staged.removed_files.entries.length

  const mergeOk =
    mergeable.kind === 'ok' ? mergeable.data.is_mergeable : false
  const conflictCount =
    mergeable.kind === 'ok' ? mergeable.data.conflicts.length : 0

  return (
    <main className="page workspace-detail-page">
      <div className="workspace-detail-head">
        <div>
          <p className="page-back">
            <Link to={`${base}/workspaces`}>← Workspaces</Link>
          </p>
          <h1 className="workspace-detail-title">
            {ws?.name || workspaceId.slice(0, 8)}
          </h1>
          {ws && (
            <div className="workspace-meta-row">
              <code className="mono muted" title={ws.id}>
                {ws.id.slice(0, 12)}
              </code>
              <span className="muted">·</span>
              <span title={ws.commit.id}>
                base <code className="mono">{ws.commit.id.slice(0, 8)}</code>
              </span>
              <span className="muted">·</span>
              <span className="muted" title={ws.commit.message}>
                {ws.commit.message}
              </span>
              {ws.created_at && (
                <>
                  <span className="muted">·</span>
                  <span className="muted" title={ws.created_at}>
                    {formatRelativeTime(ws.created_at)}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() => void onDelete()}
        >
          <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Delete
        </button>
      </div>

      <div className="tab-bar" role="tablist" aria-label="Workspace views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`workspace-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`workspace-panel-${t.id}`}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={14} aria-hidden="true" className="button-label-icon" />{t.label}
            {t.id === 'changes' && stagedCount > 0 ? ` (${stagedCount})` : ''}
          </button>
        ))}
      </div>

      {info && <p className="flash flash-success" role="status">{info}</p>}
      {error && <p className="flash flash-error" role="status">{error}</p>}

      {tab === 'changes' && (
        <div
          className="workspace-page-panel workspace-changes-panel"
          role="tabpanel"
          id="workspace-panel-changes"
          aria-labelledby="workspace-tab-changes"
        >
          <StateBlock
            loading={detail.kind === 'loading' || changes.kind === 'loading'}
            error={
              detail.kind === 'error'
                ? detail.message
                : changes.kind === 'error'
                  ? changes.message
                  : null
            }
          >
            {staged && (
              <section className="panel">
                <div className="merge-section-head">
                  <h2 className="section-label">Staged changes</h2>
                </div>
                <form
                  className="inline-form workspace-staged-filter"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setChangesPathApplied(changesPath.trim())
                  }}
                >
                  <input
                    value={changesPath}
                    onChange={(e) => setChangesPath(e.target.value)}
                    placeholder="Filter by directory, e.g. notes"
                  />
                  <button type="submit" className="btn ghost" disabled={busy}>
                    <ActionSearch size={14} aria-hidden="true" className="button-label-icon" />Filter
                  </button>
                  {changesPathApplied && (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      onClick={() => {
                        setChangesPath('')
                        setChangesPathApplied('')
                      }}
                    >
                      <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
                    </button>
                  )}
                </form>
                {changesPathApplied && (
                  <p className="muted small">
                    Showing under <code>{changesPathApplied}</code>
                  </p>
                )}
                <div className="workspace-staged-list">
                  <EntryList
                    kind="added"
                    entries={staged.added_files.entries}
                    onUnstage={onUnstage}
                    onPreview={onPreview}
                    busy={busy}
                  />
                  <EntryList
                    kind="modified"
                    entries={staged.modified_files.entries}
                    onUnstage={onUnstage}
                    onPreview={onPreview}
                    busy={busy}
                  />
                  <EntryList
                    kind="removed"
                    entries={staged.removed_files.entries}
                    onUnstage={onUnstage}
                    onPreview={onPreview}
                    busy={busy}
                  />
                </div>
                {staged.added_files.entries.length === 0 &&
                  staged.modified_files.entries.length === 0 &&
                  staged.removed_files.entries.length === 0 && (
                    <p className="muted">Nothing staged.</p>
                  )}
              </section>
            )}
          </StateBlock>

          {previewPath && (
            <section className="panel">
              <div className="merge-section-head">
                <h2 className="section-label">Preview · {previewPath}</h2>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setPreviewPath(null)
                    setPreviewText(null)
                  }}
                >
                  <ActionX size={14} aria-hidden="true" className="button-label-icon" />Close
                </button>
              </div>
              {previewText == null ? (
                <p className="muted">Loading…</p>
              ) : (
                <pre className="code-preview">{previewText}</pre>
              )}
            </section>
          )}
          <div className="grid-2">
            <section className="panel">
              <h2 className="section-label">Upload file</h2>
              <form className="form" onSubmit={onUpload}>
                <label>
                  Directory
                  <input
                    value={directory}
                    onChange={(e) => setDirectory(e.target.value)}
                    placeholder="notes (empty = repo root)"
                  />
                </label>
                <label>
                  File
                  <input name="file" type="file" required />
                </label>
                <button className="btn primary" type="submit" disabled={busy}>
                  <ActionUpload size={14} aria-hidden="true" className="button-label-icon" />Stage upload
                </button>
              </form>
            </section>

            <section className="panel">
              <h2 className="section-label">Stage removal</h2>
              <form className="form" onSubmit={onRemove}>
                <label>
                  Path
                  <input
                    value={removePath}
                    onChange={(e) => setRemovePath(e.target.value)}
                    placeholder="path/to/file"
                    required
                  />
                </label>
                <button className="btn ghost" type="submit" disabled={busy}>
                  <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Stage delete
                </button>
              </form>
            </section>
          </div>
          <section id="workspace-commit" className="panel">
            <h2 className="section-label">Commit & merge into branch</h2>
            <StateBlock
              loading={mergeable.kind === 'loading'}
              error={mergeable.kind === 'error' ? mergeable.message : null}
            >
              {mergeable.kind === 'ok' && (
                <div className="workspace-summary workspace-summary-inline">
                  <span
                    className={`merge-status-pill ${mergeOk ? 'is-ok' : 'is-bad'}`}
                  >
                    {mergeOk
                      ? `Mergeable into ${mergeBranch}`
                      : `Not mergeable into ${mergeBranch}`}
                  </span>
                  {conflictCount > 0 && (
                    <span className="error-text">
                      {conflictCount} conflict{conflictCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              )}
            </StateBlock>
            <form className="form" onSubmit={onMerge}>
              <label>
                Branch
                <select
                  value={mergeBranch}
                  onChange={(e) => setMergeBranch(e.target.value)}
                >
                  {branchNames.length > 0 ? (
                    branchNames.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))
                  ) : (
                    <option value={mergeBranch}>{mergeBranch}</option>
                  )}
                </select>
              </label>
              <label>
                Commit message
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                />
              </label>
              <div className="merge-actions">
                <button
                  className="btn primary"
                  type="submit"
                  disabled={busy || (mergeable.kind === 'ok' && !mergeOk)}
                >
                  <ActionGitCommitHorizontal size={14} aria-hidden="true" className="button-label-icon" />Commit workspace
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {tab === 'jobs' && (
        <div
          className="workspace-page-panel"
          role="tabpanel"
          id="workspace-panel-jobs"
          aria-labelledby="workspace-tab-jobs"
        >
          <section className="panel">
            <h2 className="section-label">Jobs</h2>
            <p className="muted">Workspace jobs are not implemented yet.</p>
          </section>
        </div>
      )}

      {tab === 'sessions' && (
        <div
          className="workspace-page-panel"
          role="tabpanel"
          id="workspace-panel-sessions"
          aria-labelledby="workspace-tab-sessions"
        >
          <SessionsTab
            namespace={namespace}
            repo={repo}
            workspaceId={workspaceId}
          />
        </div>
      )}

      {tab === 'metadata' && (
        <div
          className="workspace-page-panel"
          role="tabpanel"
          id="workspace-panel-metadata"
          aria-labelledby="workspace-tab-metadata"
        >
          <section className="panel">
            <h2 className="section-label">Metadata</h2>
            <MetaBody
              type="workspace"
              id={`${namespace}/${repo}!${workspaceId}`}
            />
          </section>
        </div>
      )}
    </main>
  )
}

type SessionsTabProps = {
  namespace: string
  repo: string
  workspaceId: string
}

function SessionsTab({ namespace, repo, workspaceId }: SessionsTabProps) {
  const sessions = useAsync((signal) => listSessions(signal), [])
  const [createOpen, setCreateOpen] = useState(false)
  const sessionsList = sessions.kind === 'ok' ? sessions.data.sessions : []

  // Find sessions that mount this workspace
  const mountedSessions = useMemo(() => {
    return sessionsList.filter((session) => {
      const mounts = sessionMounts(session)
      return mounts.some(
        (m) =>
          m.namespace.toLowerCase() === namespace.toLowerCase() &&
          m.repo.toLowerCase() === repo.toLowerCase() &&
          m.workspace_id === workspaceId,
      )
    })
  }, [sessionsList, namespace, repo, workspaceId])

  const createButton = (
    <div className="btn-row">
      <button
        type="button"
        className="btn primary"
        onClick={() => setCreateOpen(true)}
      >
        <ActionMonitor size={14} aria-hidden="true" className="button-label-icon" />New session
      </button>
    </div>
  )
  const createModal = createOpen && (
    <SessionCreateModal
      onClose={() => setCreateOpen(false)}
      preselectedWorkspace={{ namespace, repo, workspaceId }}
      filterRepo={{ namespace, repo }}
    />
  )

  if (sessions.kind === 'loading') {
    return <StateBlock loading>{null}</StateBlock>
  }

  if (sessions.kind === 'error') {
    return (
      <StateBlock error={sessions.message} onRetry={() => sessions.reload()}>
        {null}
      </StateBlock>
    )
  }

  if (mountedSessions.length === 0) {
    return (
      <div className="panel">
        <p className="muted">
          No sessions are currently mounting this workspace.
        </p>
        {createButton}
        {createModal}
      </div>
    )
  }

  return (
    <div className="sessions-sync-panel">
      {createButton}
      {createModal}
      <p className="muted small workspace-sessions-hint">
        {mountedSessions.length} session{mountedSessions.length === 1 ? '' : 's'}{' '}
        mounting this workspace. Sync changes from sessions back to this workspace.
      </p>
      {mountedSessions.map((session) => {
        // Find the mount for this specific workspace
        const mount = sessionMounts(session).find(
          (m) =>
            m.namespace.toLowerCase() === namespace.toLowerCase() &&
            m.repo.toLowerCase() === repo.toLowerCase() &&
            m.workspace_id === workspaceId,
        )
        if (!mount) return null
        const mountKey =
          mount.mount_path.replace(/^\/data\/?/, '').replace(/\//g, '__') ||
          'm0'
        return (
          <SessionMountDiff
            key={session.id}
            sessionId={session.id}
            sessionName={session.template_id || session.id.slice(0, 12)}
            mountKey={mountKey}
            mountPath={mount.mount_path}
          />
        )
      })}
    </div>
  )
}

type SessionMountDiffProps = {
  sessionId: string
  sessionName: string
  mountKey: string
  mountPath: string
}

function SessionMountDiff({
  sessionId,
  sessionName,
  mountKey,
  mountPath,
}: SessionMountDiffProps) {
  const diff = useAsync(
    (signal) => getMountDiff(sessionId, mountKey, signal),
    [sessionId, mountKey],
  )
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null)

  const allFiles =
    diff.kind === 'ok'
      ? [...diff.data.added, ...diff.data.modified, ...diff.data.removed]
      : []

  const allSelected =
    allFiles.length > 0 && selectedFiles.size === allFiles.length

  function toggleFile(file: string) {
    const next = new Set(selectedFiles)
    if (next.has(file)) {
      next.delete(file)
    } else {
      next.add(file)
    }
    setSelectedFiles(next)
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(allFiles))
    }
  }

  async function onSync() {
    if (selectedFiles.size === 0) return
    setSyncing(true)
    setSyncError(null)
    setSyncSuccess(null)
    try {
      const result = await syncSessionMount(
        sessionId,
        mountKey,
        Array.from(selectedFiles),
      )
      setSyncSuccess(
        `Synced ${result.uploaded} file(s): ${result.added.length} added, ${result.modified.length} modified, ${result.removed.length} removed`,
      )
      setSelectedFiles(new Set())
      diff.reload()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  if (diff.kind === 'loading') {
    return (
      <div className="workspace-mount-diff">
        <h3 className="workspace-mount-title">
          Session: {sessionName} · {mountPath}
        </h3>
        <StateBlock loading>{null}</StateBlock>
      </div>
    )
  }

  if (diff.kind === 'error') {
    return (
      <div className="workspace-mount-diff">
        <h3 className="workspace-mount-title">
          Session: {sessionName} · {mountPath}
        </h3>
        <StateBlock error={diff.message} onRetry={() => diff.reload()}>
          {null}
        </StateBlock>
      </div>
    )
  }

  const hasChanges = allFiles.length > 0

  return (
    <div className="workspace-mount-diff">
      <div className="workspace-mount-head">
        <h3 className="workspace-mount-title">
          <Link to={`/sessions/${sessionId}`} className="workspace-session-link-title">
            Session: {sessionName}
          </Link>
          <span className="muted"> · {mountPath}</span>
        </h3>
        <div className="workspace-mount-actions">
          <button
            type="button"
            className="btn primary"
            disabled={syncing || selectedFiles.size === 0}
            onClick={() => void onSync()}
          >
            <ActionRefreshCw size={14} aria-hidden="true" className="button-label-icon" />{syncing
              ? 'Syncing…'
              : `Sync ${selectedFiles.size > 0 ? `(${selectedFiles.size})` : ''}`}
          </button>
        </div>
      </div>

      {syncSuccess && (
        <p className="flash flash-success" role="status">
          {syncSuccess}
        </p>
      )}
      {syncError && (
        <p className="flash flash-error" role="status">
          {syncError}
        </p>
      )}

      {!hasChanges ? (
        <p className="muted workspace-no-changes">No changes detected</p>
      ) : (
        <div className="workspace-changes">
          <div className="workspace-changes-head">
            <label className="workspace-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
              />
              <span>
                {allFiles.length} change{allFiles.length === 1 ? '' : 's'}
              </span>
            </label>
          </div>
          <ul className="workspace-entry-list">
            {diff.data.added.map((file) => (
              <li key={file} className="workspace-entry-row workspace-sync-entry">
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file)}
                  onChange={() => toggleFile(file)}
                />
                <span className="workspace-entry-badge is-added" aria-hidden />
                <div className="workspace-entry-main">
                  <code className="mono workspace-entry-name">{file}</code>
                  <span className="workspace-entry-status muted small">Added</span>
                </div>
              </li>
            ))}
            {diff.data.modified.map((file) => (
              <li key={file} className="workspace-entry-row workspace-sync-entry">
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file)}
                  onChange={() => toggleFile(file)}
                />
                <span className="workspace-entry-badge is-modified" aria-hidden />
                <div className="workspace-entry-main">
                  <code className="mono workspace-entry-name">{file}</code>
                  <span className="workspace-entry-status muted small">
                    Modified
                  </span>
                </div>
              </li>
            ))}
            {diff.data.removed.map((file) => (
              <li key={file} className="workspace-entry-row workspace-sync-entry">
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file)}
                  onChange={() => toggleFile(file)}
                />
                <span className="workspace-entry-badge is-removed" aria-hidden />
                <div className="workspace-entry-main">
                  <code className="mono workspace-entry-name">{file}</code>
                  <span className="workspace-entry-status muted small">
                    Removed
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
