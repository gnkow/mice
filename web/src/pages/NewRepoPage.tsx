import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createRepository } from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'

export function NewRepoPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await createRepository({
        namespace: namespace.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
      })
      navigate(
        `/n/${encodeURIComponent(res.repository.namespace)}/r/${encodeURIComponent(res.repository.name)}/tree/main`,
      )
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

  return (
    <main className="page narrow">
      <h1>New project</h1>
      <p className="lede">
        Creating a project under a new namespace will create that namespace.
      </p>

      <form className="form" onSubmit={onSubmit}>
        <label>
          Namespace
          <input
            required
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="my-team"
            autoComplete="off"
          />
        </label>
        <label>
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="dataset"
            autoComplete="off"
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </main>
  )
}
