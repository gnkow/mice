import { Monitor as ActionMonitor, Plus as ActionPlus, Trash2 as ActionTrash, X as ActionX } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import {
  NewWorkspaceFields,
  emptyNewWorkspace,
  newWorkspaceInput,
  type NewWorkspaceDraft,
} from './NewWorkspaceFields'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'
import { createSession, listSessionTemplates, type SessionMountInput } from '../lib/sessions'
import { listMiceWorkspaces, type MiceWorkspace } from '../lib/workspaces'

type Props = {
  onClose: () => void
  /** When set, only this repository's workspaces can be mounted or created. */
  filterRepo?: {
    namespace: string
    repo: string
  }
}

const NEW = '__new__'

type Row = {
  key: number
  choice: string // workspace id or NEW
  mode: 'ro' | 'rw'
  draft: NewWorkspaceDraft
}

function readOnlyOnly(w: MiceWorkspace): boolean {
  if (w.mountable_modes) return !w.mountable_modes.includes('rw')
  return Boolean(w.writer)
}

export function SessionCreateModal({ onClose, filterRepo }: Props) {
  const navigate = useNavigate()
  const templates = useAsync((signal) => listSessionTemplates(signal), [])
  const workspaces = useAsync(
    (signal) =>
      listMiceWorkspaces(
        filterRepo ? { namespace: filterRepo.namespace, repo: filterRepo.repo } : undefined,
        signal,
      ),
    [filterRepo?.namespace, filterRepo?.repo],
  )
  const catalog = useAsync((signal) => loadCatalog(signal), [])

  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('linux-xfce')
  const [rows, setRows] = useState<Row[]>([])
  const [seeded, setSeeded] = useState(false)

  const tplList = templates.kind === 'ok' ? templates.data.templates : []
  const selectedTpl = useMemo(() => tplList.find((t) => t.id === templateId) ?? null, [tplList, templateId])

  const ready = useMemo(
    () => (workspaces.kind === 'ok' ? workspaces.data.workspaces : []).filter((w) => w.status === 'ready'),
    [workspaces],
  )
  const repos = useMemo(() => {
    if (filterRepo) return [{ namespace: filterRepo.namespace, name: filterRepo.repo }]
    return catalog.kind === 'ok' ? catalog.data.repositories : []
  }, [catalog, filterRepo])

  const loaded = workspaces.kind === 'ok'
  if (loaded && !seeded) {
    setSeeded(true)
    const first = ready[0]
    setRows([
      {
        key: 1,
        choice: first ? first.id : NEW,
        mode: first && !readOnlyOnly(first) ? 'rw' : 'ro',
        draft: emptyNewWorkspace(filterRepo ? `${filterRepo.namespace}/${filterRepo.repo}` : ''),
      },
    ])
  }

  const wsById = (id: string) => ready.find((w) => w.id === id)
  const nextKey = () => Math.max(0, ...rows.map((r) => r.key)) + 1
  const patchRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  function onChoose(row: Row, choice: string) {
    const w = wsById(choice)
    patchRow(row.key, {
      choice,
      mode: w && readOnlyOnly(w) ? 'ro' : row.mode,
    })
  }

  function addRow() {
    const used = new Set(rows.map((r) => r.choice))
    const free = ready.find((w) => !used.has(w.id))
    setRows((rs) => [
      ...rs,
      {
        key: nextKey(),
        choice: free ? free.id : NEW,
        mode: free && !readOnlyOnly(free) ? 'rw' : 'ro',
        draft: emptyNewWorkspace(filterRepo ? `${filterRepo.namespace}/${filterRepo.repo}` : ''),
      },
    ])
  }

  const rowsValid = rows.every((r) => {
    if (r.choice !== NEW) return true
    const n = r.draft.name.trim()
    return (
      r.draft.repoKey !== '' &&
      n.length !== 1 &&
      (r.draft.sourceKind === 'branch' ? r.draft.branch !== '' : r.draft.commit !== '')
    )
  })
  const duplicate = new Set(rows.filter((r) => r.choice !== NEW).map((r) => r.choice)).size !==
    rows.filter((r) => r.choice !== NEW).length

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const mounts: SessionMountInput[] = rows.map((r) =>
        r.choice === NEW
          ? { new_workspace: newWorkspaceInput(r.draft), mount_mode: r.mode }
          : { workspace_id: r.choice, mount_mode: r.mode },
      )
      const { session } = await createSession({
        template_id: templateId,
        mounts: mounts.length > 0 ? mounts : undefined,
      })
      navigate(`/sessions/${encodeURIComponent(session.id)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal title="New session" onClose={onClose}>
      <form className="form" onSubmit={onCreate}>
        <label>
          Template
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={creating}>
            {tplList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {tplList.length === 0 ? <option value="linux-xfce">Linux XFCE desktop</option> : null}
          </select>
        </label>
        <p className="muted small">
          {selectedTpl?.description || 'Full XFCE desktop over RDP (docker provisioner).'}
        </p>

        <div className="form-section-head">
          <span className="form-section-label">Workspaces</span>
          <button type="button" className="btn small" onClick={addRow} disabled={creating}>
            <ActionPlus size={14} aria-hidden="true" className="button-label-icon" />Add workspace
          </button>
        </div>
        <p className="muted small">Sessions work on workspaces. Mount existing ones or create one on demand.</p>

        {rows.map((row, i) => {
          const w = wsById(row.choice)
          const roOnly = w ? readOnlyOnly(w) : false
          return (
            <fieldset key={row.key} className="session-ws-card" disabled={creating}>
              <legend className="sr-only">Workspace {i + 1}</legend>
              <div className="session-ws-head">
                <select
                  value={row.choice}
                  onChange={(e) => onChoose(row, e.target.value)}
                  aria-label={`Workspace ${i + 1}`}
                >
                  {ready.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name || x.id} · {x.namespace}/{x.repo}
                      {readOnlyOnly(x) ? ' (in use — read-only)' : ''}
                    </option>
                  ))}
                  <option value={NEW}>New workspace…</option>
                </select>
                <button
                  type="button"
                  className="icon-round workspace-delete"
                  title="Remove workspace"
                  aria-label={`Remove workspace ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                >
                  <ActionTrash size={14} aria-hidden />
                </button>
              </div>
              {row.choice === NEW ? (
                <NewWorkspaceFields
                  draft={row.draft}
                  onChange={(draft) => patchRow(row.key, { draft })}
                  repos={repos}
                  disabled={creating}
                />
              ) : null}
              <label>
                Access
                <select
                  value={roOnly ? 'ro' : row.mode}
                  disabled={roOnly}
                  onChange={(e) => patchRow(row.key, { mode: e.target.value as 'ro' | 'rw' })}
                  aria-label={`Workspace ${i + 1} access`}
                >
                  <option value="rw">Read-write (single writer)</option>
                  <option value="ro">Read-only</option>
                </select>
              </label>
              {roOnly ? (
                <p className="muted small">
                  <span className="pill warn">In use</span> Another {w?.writer?.kind ?? 'writer'} holds the write
                  lease, so this workspace can only be mounted read-only.
                </p>
              ) : null}
              {row.choice === NEW ? (
                <p className="muted small">The workspace is created and prepared before the session starts.</p>
              ) : null}
            </fieldset>
          )
        })}
        {duplicate ? <p className="field-hint error-text">The same workspace is selected more than once.</p> : null}
        {rows.length === 0 ? <p className="muted small">Desktop only — no workspace mounted.</p> : null}

        <div className="btn-row modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
          </button>
          <button className="btn primary" type="submit" disabled={creating || !rowsValid || duplicate}>
            <ActionMonitor size={14} aria-hidden="true" className="button-label-icon" />{creating ? 'Creating…' : 'Create session'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  )
}
