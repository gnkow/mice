import { KeyRound as ActionKeyRound, LogOut as ActionLogOut } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { logout } from '../lib/auth'
import { submitAccessRequest } from '../lib/authzApi'
import {
  pendingShellViewAfterSubmit,
  type PendingShellView,
} from '../lib/pendingAccessShell'

/**
 * No-access shell (RBAC S32): only Request Access, then a pending confirmation.
 * No app navigation — sign out is the only exit.
 */
export function PendingAccessPage() {
  const [view, setView] = useState<PendingShellView>('request')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onRequest(e: FormEvent) {
    e.preventDefault()
    const justification = message.trim()
    if (!justification) {
      setError('Justification is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // S32: default to User; S33 adds role radios / custom permissions.
      await submitAccessRequest({ message: justification, requestedRole: 'user' })
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
              Submit a request below to ask for User access.
            </p>
            <form className="form" onSubmit={onRequest}>
              <label>
                Justification (required)
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
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
