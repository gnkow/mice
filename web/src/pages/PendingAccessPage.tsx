import { KeyRound as ActionKeyRound, LogOut as ActionLogOut } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { fetchAuthzMe, logout } from '../lib/auth'
import { submitAccessRequest } from '../lib/authzApi'
import { useAsync } from '../hooks/useAsync'
import {
  pendingShellViewAfterSubmit,
  type PendingShellView,
} from '../lib/pendingAccessShell'
import {
  REQUESTABLE_ROLES,
  buildAccessRequestPayload,
  togglePermission,
  type RequestAccessFormState,
} from '../lib/requestAccessForm'

/**
 * No-access shell (S32) + Request Access form (S33):
 * role radios or custom permissions, then pending confirmation. Sign out only.
 */
export function PendingAccessPage() {
  const catalog = useAsync((signal) => fetchAuthzMe(signal), [])
  const [view, setView] = useState<PendingShellView>('request')
  const [form, setForm] = useState<RequestAccessFormState>({
    mode: 'role',
    role: 'user',
    permissions: [],
    message: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onRequest(e: FormEvent) {
    e.preventDefault()
    const built = buildAccessRequestPayload(form)
    if (!built.ok) {
      setError(built.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submitAccessRequest(built.payload)
      setView(pendingShellViewAfterSubmit(view))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  function onSignOut() {
    void logout().then((r) => {
      if (r.idpLogoutUrl) window.location.href = r.idpLogoutUrl
      else window.location.href = '/login'
    })
  }

  const permissionCatalog =
    catalog.kind === 'ok' && catalog.data ? catalog.data.permissionCatalog : []

  return (
    <div className="login-shell">
      <main className="login-page pending-access">
        <p className="login-brand">MICE</p>
        {view === 'submitted' ? (
          <>
            <h1>Request pending</h1>
            <p className="lede">
              Your access request was submitted. A manager or admin will review it.
              You will gain access once it is approved.
            </p>
            <p className="flash flash-success" role="status">
              Request submitted. No further action is needed right now.
            </p>
          </>
        ) : (
          <>
            <h1>Request access</h1>
            <p className="lede">
              You are signed in, but you do not have a formal role yet.
              Choose a role or specific permissions, then explain why you need access.
            </p>
            <form className="form" onSubmit={onRequest}>
              <fieldset>
                <legend>Request type</legend>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="mode"
                    checked={form.mode === 'role'}
                    onChange={() => setForm((f) => ({ ...f, mode: 'role' }))}
                  />
                  Formal role
                </label>
                <label className="radio-row">
                  <input
                    type="radio"
                    name="mode"
                    checked={form.mode === 'custom'}
                    onChange={() => setForm((f) => ({ ...f, mode: 'custom' }))}
                  />
                  Custom permissions
                </label>
              </fieldset>

              {form.mode === 'role' ? (
                <fieldset>
                  <legend>Role</legend>
                  {REQUESTABLE_ROLES.map((r) => (
                    <label key={r.id} className="radio-row">
                      <input
                        type="radio"
                        name="role"
                        checked={form.role === r.id}
                        onChange={() => setForm((f) => ({ ...f, role: r.id }))}
                      />
                      <span>
                        <strong>{r.label}</strong>
                        <span className="muted small" style={{ display: 'block' }}>
                          {r.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <fieldset>
                  <legend>Permissions</legend>
                  {catalog.kind === 'loading' && <p className="muted small">Loading catalog…</p>}
                  {catalog.kind === 'error' && (
                    <p className="flash flash-error" role="alert">
                      Could not load the permission catalog.
                    </p>
                  )}
                  <div
                    className="perm-multiselect"
                    style={{
                      maxHeight: '12rem',
                      overflow: 'auto',
                      border: '1px solid var(--color-border)',
                      borderRadius: '0.375rem',
                      padding: '0.5rem',
                    }}
                  >
                    {permissionCatalog.map((perm) => (
                      <label key={perm} className="radio-row" style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={form.permissions.includes(perm)}
                          onChange={() =>
                            setForm((f) => ({
                              ...f,
                              permissions: togglePermission(f.permissions, perm),
                            }))
                          }
                        />
                        <code className="small">{perm}</code>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <label>
                Justification (required)
                <textarea
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  rows={3}
                  placeholder="Why you need access"
                  required
                />
              </label>
              <button className="btn primary" type="submit" disabled={busy}>
                <ActionKeyRound size={14} aria-hidden="true" className="button-label-icon" />
                {busy ? 'Submitting…' : 'Request access'}
              </button>
            </form>
            {error && (
              <p className="flash flash-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <div className="btn-row">
          <button type="button" className="btn" onClick={onSignOut}>
            <ActionLogOut size={14} aria-hidden="true" className="button-label-icon" />
            Sign out
          </button>
        </div>
      </main>
    </div>
  )
}
