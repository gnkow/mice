import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  deleteRepository,
  renameRepository,
  transferRepository,
} from '../lib/oxen/api'
import { confirmDelete } from '../lib/confirmDelete'
import { OxenApiError } from '../lib/oxen/types'

export function RepoSettingsPage() {
  const { namespace = '', repo = '' } = useParams()
  const navigate = useNavigate()
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [targetNs, setTargetNs] = useState('')

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(
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

  function onRename(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      await renameRepository(namespace, repo, newName.trim())
      navigate(
        `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(newName.trim())}/tree/main`,
      )
    })
  }

  function onTransfer(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      const res = await transferRepository(namespace, repo, targetNs.trim())
      navigate(
        `/n/${encodeURIComponent(res.repository.namespace)}/r/${encodeURIComponent(res.repository.name)}/tree/main`,
      )
    })
  }

  async function onDelete() {
    if (
      !(await confirmDelete({
        title: `Delete repository ${namespace}/${repo}`,
        detail:
          'The entire repository and all of its history will be permanently removed from the server.',
        confirmWord: repo,
      }))
    ) {
      return
    }
    void run(async () => {
      await deleteRepository(namespace, repo)
      navigate(`/n/${encodeURIComponent(namespace)}`)
    })
  }

  return (
    <main className="page wide">
      <h2 className="section-label">Settings</h2>
      <p className="muted">
        Repository admin for <code>{namespace}/{repo}</code>
      </p>

      <section className="panel">
        <h3 className="section-label">Rename</h3>
        <p className="muted small">
          Rename is not supported on name-addressed self-hosted oxen-server
          (Hub / UUID only).
        </p>
        <form className="inline-form" onSubmit={onRename}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New name"
            required
          />
          <button className="btn ghost" type="submit" disabled={busy}>
            Rename
          </button>
        </form>
      </section>

      <section className="panel">
        <h3 className="section-label">Transfer</h3>
        <p className="muted small">Move this repository to another namespace.</p>
        <form className="inline-form" onSubmit={onTransfer}>
          <input
            value={targetNs}
            onChange={(e) => setTargetNs(e.target.value)}
            placeholder="Target namespace"
            required
          />
          <button className="btn ghost" type="submit" disabled={busy}>
            Transfer
          </button>
        </form>
      </section>

      <section className="panel danger-zone">
        <h3 className="section-label">Danger zone</h3>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() => void onDelete()}
        >
          Delete repository
        </button>
      </section>

      {actionError && <p className="error">{actionError}</p>}
    </main>
  )
}
