import { Layers as ActionLayers, Monitor as ActionMonitor, Trash2 as ActionTrash2, X as ActionX } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './Modal'
import { useAsync } from '../hooks/useAsync'
import { loadCatalog } from '../lib/catalog'
import {
  createSession,
  listSessionTemplates,
  type SessionMountInput,
} from '../lib/sessions'

type DraftMount = {
  key: string
  namespace: string
  repo: string
  workspace_id: string
  mount_mode: 'ro' | 'rw'
}

function newDraftKey(): string {
  return `m_${Math.random().toString(36).slice(2, 10)}`
}

type Props = {
  onClose: () => void
  preselectedWorkspace?: {
    namespace: string
    repo: string
    workspaceId: string
  }
  filterRepo?: {
    namespace: string
    repo: string
  }
}

export function SessionCreateModal({
  onClose,
  preselectedWorkspace,
  filterRepo,
}: Props) {
  const navigate = useNavigate()
  const templates = useAsync((signal) => listSessionTemplates(signal), [])
  const catalog = useAsync((signal) => loadCatalog(signal), [])
  
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('linux-xfce')
  const [drafts, setDrafts] = useState<DraftMount[]>(() => {
    if (preselectedWorkspace) {
      return [
        {
          key: newDraftKey(),
          namespace: preselectedWorkspace.namespace,
          repo: preselectedWorkspace.repo,
          workspace_id: preselectedWorkspace.workspaceId,
          mount_mode: 'rw',
        },
      ]
    }
    return []
  })

  const tplList = templates.kind === 'ok' ? templates.data.templates : []
  const selectedTpl = useMemo(
    () => tplList.find((t) => t.id === templateId) ?? null,
    [tplList, templateId],
  )
  
  const allWorkspaces = catalog.kind === 'ok' ? catalog.data.workspaces : []
  const workspaces = filterRepo
    ? allWorkspaces.filter(
        (w) =>
          w.namespace === filterRepo.namespace && w.repo === filterRepo.repo,
      )
    : allWorkspaces

  function addWorkspaceMount() {
    const first = workspaces[0]
    setDrafts((prev) => [
      ...prev,
      {
        key: newDraftKey(),
        namespace: first?.namespace || '',
        repo: first?.repo || '',
        workspace_id: first?.id || '',
        mount_mode: 'rw',
      },
    ])
  }

  function updateDraft(key: string, patch: Partial<DraftMount>) {
    setDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    )
  }

  function removeDraft(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key))
  }

  function toMountInputs(): SessionMountInput[] {
    return drafts.map((d) => ({
      namespace: d.namespace.trim(),
      repo: d.repo.trim(),
      workspace_id: d.workspace_id.trim() || null,
      mount_mode: d.mount_mode,
    }))
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const mounts = toMountInputs()
      for (const m of mounts) {
        if (!m.namespace || !m.repo) {
          throw new Error('Each workspace needs namespace and repo')
        }
        if (!m.workspace_id) {
          throw new Error('Each workspace needs a workspace ID')
        }
      }
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

  const wsOptionsFor = (d: DraftMount) =>
    workspaces.filter(
      (w) =>
        (!d.namespace || w.namespace === d.namespace) &&
        (!d.repo || w.repo === d.repo),
    )

  return (
    <Modal title="New session" onClose={onClose}>
      <form className="form" onSubmit={onCreate}>
        <label>
          Template
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={creating}
          >
            {tplList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            {tplList.length === 0 ? (
              <option value="linux-xfce">Linux XFCE desktop</option>
            ) : null}
          </select>
        </label>
        <p className="muted small">
          {selectedTpl?.description ||
            'Full XFCE desktop over RDP (docker provisioner).'}
        </p>

        <div className="form-section">
          <div className="form-section-head">
            <label className="form-section-label">Workspaces</label>
            <button
              type="button"
              className="btn ghost small"
              disabled={creating || workspaces.length === 0}
              onClick={addWorkspaceMount}
            >
              <ActionLayers size={14} aria-hidden="true" className="button-label-icon" />Add workspace
            </button>
          </div>
          {drafts.length === 0 ? (
            <p className="muted small">
              No workspaces — desktop only. Add workspaces to access your data.
            </p>
          ) : (
            <div className="workspace-mounts-list">
              {drafts.map((d) => (
                <div key={d.key} className="workspace-mount-item">
                  <select
                    value={`${d.namespace}/${d.repo}/${d.workspace_id}`}
                    disabled={creating}
                    onChange={(e) => {
                      const w = workspaces.find(
                        (x) =>
                          `${x.namespace}/${x.repo}/${x.id}` === e.target.value,
                      )
                      if (!w) return
                      updateDraft(d.key, {
                        namespace: w.namespace,
                        repo: w.repo,
                        workspace_id: w.id,
                      })
                    }}
                  >
                    {wsOptionsFor(d).length === 0 ? (
                      <option value="">No workspaces</option>
                    ) : null}
                    {(wsOptionsFor(d).length ? wsOptionsFor(d) : workspaces).map(
                      (w) => (
                        <option
                          key={`${w.namespace}/${w.repo}/${w.id}`}
                          value={`${w.namespace}/${w.repo}/${w.id}`}
                        >
                          {w.namespace}/{w.repo} · {w.name || w.id.slice(0, 8)}
                        </option>
                      ),
                    )}
                  </select>
                  <select
                    value={d.mount_mode}
                    disabled={creating}
                    onChange={(e) =>
                      updateDraft(d.key, {
                        mount_mode: e.target.value as 'ro' | 'rw',
                      })
                    }
                  >
                    <option value="rw">rw</option>
                    <option value="ro">ro</option>
                  </select>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={creating}
                    onClick={() => removeDraft(d.key)}
                  >
                    <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="btn-row modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            <ActionX size={14} aria-hidden="true" className="button-label-icon" />Cancel
          </button>
          <button className="btn primary" type="submit" disabled={creating}>
            <ActionMonitor size={14} aria-hidden="true" className="button-label-icon" />{creating ? 'Creating…' : 'Create session'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </Modal>
  )
}
