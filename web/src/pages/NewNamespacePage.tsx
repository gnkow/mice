import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  NamespaceCreateSettings,
  type NamespaceCreateSettingsValue,
} from '../components/NamespaceCreateSettings'
import { fetchAuthzMe } from '../lib/auth'
import {
  createNamespaceAuthz,
  putNamespaceMember,
} from '../lib/authzApi'
import { useAsync } from '../hooks/useAsync'

export function NewNamespacePage() {
  const navigate = useNavigate()
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  const [settings, setSettings] = useState<NamespaceCreateSettingsValue>({
    name: '',
    basePermission: 'none',
    membersCanCreateRepos: true,
    members: [],
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canCreate =
    authz.kind === 'ok' &&
    authz.data &&
    (authz.data.instanceAdmin || authz.data.permissions.create_namespace)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const name = settings.name.trim()
      const res = await createNamespaceAuthz({
        name,
        basePermission: settings.basePermission,
        membersCanCreateRepos: settings.membersCanCreateRepos,
      })
      for (const m of settings.members) {
        await putNamespaceMember(name, m)
      }
      navigate(`/n/${encodeURIComponent(res.name)}/settings`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page narrow">
      <p className="muted small">
        <Link to="/namespaces">← Namespaces</Link>
      </p>
      <h1>New namespace</h1>
      <p className="lede">
        Create a namespace without a repository. You become Owner and can add
        members and repositories later.
      </p>

      {authz.kind === 'loading' && (
        <p className="muted">Checking permissions…</p>
      )}

      {authz.kind === 'ok' && !canCreate && (
        <p className="flash flash-error" role="status">
          You need the <code>create_namespace</code> permission or instance
          admin to create a namespace.
        </p>
      )}

      {(authz.kind !== 'ok' || canCreate) && (
        <form className="form" onSubmit={onSubmit}>
          <NamespaceCreateSettings
            value={settings}
            onChange={setSettings}
            disabled={!canCreate || busy}
          />
          {error && <p className="flash flash-error" role="status">{error}</p>}
          <div className="btn-row">
            <button
              className="btn primary"
              type="submit"
              disabled={!canCreate || busy}
            >
              {busy ? 'Creating…' : 'Create namespace'}
            </button>
            <Link className="btn ghost" to="/namespaces">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </main>
  )
}
