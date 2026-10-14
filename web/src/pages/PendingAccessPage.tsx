import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { logout } from '../lib/auth'
import { submitAccessRequest } from '../lib/authzApi'

/**
 * Shown when AuthZ is enforcing and the signed-in user has no grants
 * (and is not instance admin / create_namespace).
 */
export function PendingAccessPage() {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onRequest(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      await submitAccessRequest(message)
      setStatus('Request submitted. An admin will review it.')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-boot pending-access">
      <h1>Access pending</h1>
      <p className="muted">
        You are signed in, but you do not have access to any namespace yet.
        Ask a namespace Owner or instance admin to grant you membership, or
        submit a request below.
      </p>
      <form className="form" onSubmit={onRequest}>
        <label>
          Message (optional)
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Why you need access"
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Request access'}
        </button>
      </form>
      {status && <p className="muted">{status}</p>}
      <p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void logout().then((r) => {
              if (r.idpLogoutUrl) window.location.href = r.idpLogoutUrl
              else window.location.href = '/login'
            })
          }}
        >
          Sign out
        </button>{' '}
        <Link to="/login">Back to login</Link>
      </p>
    </div>
  )
}
