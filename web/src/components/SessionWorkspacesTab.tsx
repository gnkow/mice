import {
  Plus as ActionPlus,
  RefreshCw as ActionRefresh,
  Unplug as ActionUnplug,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SessionMountModal } from './SessionMountModal'
import { StatusPill } from './StatusPill'
import { useAsync } from '../hooks/useAsync'
import { confirmDelete } from '../lib/confirmDelete'
import {
  remountSession,
  sessionMounts,
  updateSessionMounts,
  type DesktopSession,
  type SessionMount,
  type SessionMountInput,
} from '../lib/sessions'
import { listMiceWorkspaces } from '../lib/workspaces'

const EDITABLE = ['ready', 'connected', 'stopped', 'failed']

type Props = {
  session: DesktopSession
  onChanged: () => void | Promise<void>
  onError: (message: string) => void
}

function asInput(m: SessionMount): SessionMountInput {
  return { workspace_id: m.workspace_id!, mount_mode: m.mount_mode }
}

/** Workspaces mounted in a session, with icon actions to switch access, unmount and mount more. */
export function SessionWorkspacesTab({ session, onChanged, onError }: Props) {
  const mounts = sessionMounts(session)
  const all = useAsync((signal) => listMiceWorkspaces(undefined, signal), [session.id, session.status])
  const known = all.kind === 'ok' ? all.data.workspaces : []
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const editable = EDITABLE.includes(session.status)
  const mounted = new Set(mounts.map((m) => m.workspace_id))
  const candidates = known.filter((w) => w.status === 'ready' && !mounted.has(w.id))

  async function apply(next: SessionMountInput[]) {
    await updateSessionMounts(session.id, next)
    await onChanged()
  }

  async function guarded(title: string, detail: string, next: SessionMountInput[]) {
    const ok = await confirmDelete({ title, detail: `${detail} The session restarts; files outside mounted workspaces are lost.`, requireTypedConfirm: false })
    if (!ok) return
    setBusy(true)
    try {
      await apply(next)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  function changeAccess(m: SessionMount, to: 'ro' | 'rw') {
    if (to === m.mount_mode) return
    void guarded(
      to === 'ro' ? 'Switch to read-only?' : 'Switch to read-write?',
      `Workspace ${m.workspace_id} will be mounted ${to === 'ro' ? 'read-only' : 'read-write'}.`,
      mounts.filter((x) => x.workspace_id).map((x) => (x === m ? { ...asInput(x), mount_mode: to } : asInput(x))),
    )
  }

  function unmount(m: SessionMount) {
    void guarded(
      'Unmount workspace?',
      `Workspace ${m.workspace_id} will be detached from this session.`,
      mounts.filter((x) => x.workspace_id && x !== m).map(asInput),
    )
  }

  async function retryRw(m: SessionMount) {
    setBusy(true)
    try {
      await remountSession(session.id, m.workspace_id ?? undefined)
      await onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Remount failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="btn-row session-ws-toolbar">
        <span className="muted small">
          {mounts.length} workspace{mounts.length === 1 ? '' : 's'} mounted
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !editable}
          title={editable ? undefined : `Not possible while the session is ${session.status}`}
          onClick={() => setAddOpen(true)}
        >
          <ActionPlus size={14} aria-hidden="true" className="button-label-icon" />Mount workspace
        </button>
      </div>

      {mounts.length === 0 ? (
        <p className="muted">No workspace is mounted — this session is a desktop only.</p>
      ) : (
        <div className="table-container">
          <table className="table workspaces-table">
            <thead>
              <tr>
                <th scope="col">Workspace</th>
                <th scope="col">Repository</th>
                <th scope="col">Status</th>
                <th scope="col">Access</th>
                <th scope="col">Mounted at</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {mounts.map((m) => {
                const repoPath = `/n/${encodeURIComponent(m.namespace)}/r/${encodeURIComponent(m.repo)}`
                const ws = known.find((w) => w.id === m.workspace_id)
                const effective = m.effective_mode ?? 'pending'
                const degraded = m.mount_mode === 'rw' && m.effective_mode === 'ro'
                const label = ws?.name || m.workspace_id || `${m.namespace}/${m.repo}`
                const canRw = m.mount_mode === 'rw' || !ws || !ws.mountable_modes || ws.mountable_modes.includes('rw')
                return (
                  <tr key={m.mount_path} data-workspace={m.workspace_id}>
                    <td>
                      {m.workspace_id ? (
                        <Link className="workspace-name-link" to={`${repoPath}/workspaces/${encodeURIComponent(m.workspace_id)}`}>
                          {label}
                        </Link>
                      ) : (
                        <span className="mono">{label}</span>
                      )}{' '}
                      <span className="mono muted small">{m.workspace_id}</span>
                    </td>
                    <td className="muted small">
                      <Link to={repoPath}>{m.namespace}/{m.repo}</Link>
                    </td>
                    <td className="small">{ws ? <StatusPill status={ws.status} /> : <span className="muted">—</span>}</td>
                    <td className="small">
                      {m.workspace_id ? (
                        <select
                          aria-label={`Access for workspace ${m.workspace_id}`}
                          value={m.mount_mode}
                          disabled={busy || !editable}
                          title="Changing access restarts the session"
                          onChange={(e) => changeAccess(m, e.target.value as 'ro' | 'rw')}
                        >
                          <option value="ro">Read-only</option>
                          <option value="rw" disabled={!canRw}>Read-write</option>
                        </select>
                      ) : null}
                      <span className={`pill ${effective === 'rw' ? 'ok' : degraded ? 'warn' : ''}`}>
                        {effective === 'rw' ? 'Read-write' : effective === 'ro' ? 'Read-only' : 'Pending'}
                      </span>
                      {degraded ? <span className="muted small"> requested read-write</span> : null}
                    </td>
                    <td className="mono small">{m.mount_path}</td>
                    <td className="workspaces-col-actions">
                      <div className="workspace-row-actions">
                        {degraded ? (
                          <button
                            type="button"
                            className="icon-round"
                            disabled={busy || !editable}
                            title="Retry read-write (restarts the session)"
                            aria-label={`Retry read-write for workspace ${m.workspace_id}`}
                            onClick={() => void retryRw(m)}
                          >
                            <ActionRefresh size={14} aria-hidden />
                          </button>
                        ) : null}
                        {m.workspace_id ? (
                          <button
                            type="button"
                            className="icon-round workspace-delete"
                            disabled={busy || !editable}
                            title="Unmount"
                            aria-label={`Unmount workspace ${m.workspace_id}`}
                            onClick={() => unmount(m)}
                          >
                            <ActionUnplug size={14} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {addOpen ? (
        <SessionMountModal
          candidates={candidates}
          onClose={() => setAddOpen(false)}
          onSubmit={async (mount) => {
            await apply([...mounts.filter((x) => x.workspace_id).map(asInput), mount])
            setAddOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
