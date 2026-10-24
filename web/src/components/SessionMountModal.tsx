import { Plus as ActionPlus, X as ActionX } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import {
  NewWorkspaceFields,
  emptyNewWorkspace,
  newWorkspaceInput,
} from './NewWorkspaceFields'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'
import type { SessionMountInput } from '../lib/sessions'
import type { MiceWorkspace } from '../lib/workspaces'

const NEW = '__new__'

type Props = {
  /** Ready workspaces that are not yet mounted in the session. */
  candidates: MiceWorkspace[]
  onClose: () => void
  onSubmit: (mount: SessionMountInput) => Promise<void>
}

function readOnlyOnly(w: MiceWorkspace): boolean {
  if (w.mountable_modes) return !w.mountable_modes.includes('rw')
  return Boolean(w.writer)
}

/** Mount one more workspace (existing or created on demand) into a session. */
export function SessionMountModal({ candidates, onClose, onSubmit }: Props) {
  const catalog = useAsync((signal) => loadCatalog(signal), [])
  const repos = useMemo(() => (catalog.kind === 'ok' ? catalog.data.repositories : []), [catalog])
  const [choice, setChoice] = useState(candidates[0]?.id ?? NEW)
  const [mode, setMode] = useState<'ro' | 'rw'>('rw')
  const [draft, setDraft] = useState(emptyNewWorkspace())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const w = candidates.find((x) => x.id === choice)
  const roOnly = w ? readOnlyOnly(w) : false
  const n = draft.name.trim()
  const valid =
    choice !== NEW ||
    (draft.repoKey !== '' && n.length !== 1 && (draft.sourceKind === 'branch' ? draft.branch !== '' : draft.commit !== ''))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const mount_mode = roOnly ? 'ro' : mode
      await onSubmit(choice === NEW ? { new_workspace: newWorkspaceInput(draft), mount_mode } : { workspace_id: choice, mount_mode })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mount failed')
      setBusy(false)
    }
  }

  return (
    <Modal title="Mount workspace" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Workspace
          <select value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy} aria-label="Workspace">
            {candidates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name || x.id} · {x.namespace}/{x.repo}
                {readOnlyOnly(x) ? ' (in use — read-only)' : ''}
              </option>
            ))}
            <option value={NEW}>New workspace…</option>
          </select>
        </label>
        {choice === NEW ? <NewWorkspaceFields draft={draft} onChange={setDraft} repos={repos} disabled={busy} /> : null}
        <label>
          Access
          <select
            value={roOnly ? 'ro' : mode}
            disabled={roOnly || busy}
            onChange={(e) => setMode(e.target.value as 'ro' | 'rw')}
            aria-label="Access"
          >
            <option value="rw">Read-write (single writer)</option>
            <option value="ro">Read-only</option>
          </select>
        </label>
        {roOnly ? (
          <p className="muted small">
            <span className="pill warn">In use</span> Another {w?.writer?.kind ?? 'writer'} holds the write lease, so
            this workspace can only be mounted read-only.
          </p>
        ) : null}
        <p className="muted small">The session restarts to apply the new mount. Files outside mounted workspaces are lost.</p>
        <div className="btn-row modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
          </button>
          <button className="btn primary" type="submit" disabled={busy || !valid}>
            <ActionPlus size={14} aria-hidden="true" className="button-label-icon" />{busy ? 'Mounting…' : 'Mount workspace'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  )
}
