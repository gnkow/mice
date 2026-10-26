import { AlertTriangle, Shield } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'

/**
 * Feature 5: Admin Revocation UI
 * 
 * Allows admins to revoke user access and manage suspensions.
 * Backend: /auth/admin/revoke, /auth/admin/suspend, /auth/admin/suspensions/pending
 */

type PendingSuspension = {
  id: string
  principal: string
  suspendedBy: string
  reason: string
  createdAt: string
  expiresAt: string
}

async function revokeUser(principal: string, reason: string): Promise<void> {
  const res = await fetch('/auth/admin/revoke', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ principal, reason }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Revocation failed' }))
    throw new Error(data.error || 'Revocation failed')
  }
}

async function suspendUser(principal: string, reason: string): Promise<{ requestId: string }> {
  const res = await fetch('/auth/admin/suspend', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ principal, reason }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Suspension failed' }))
    throw new Error(data.error || 'Suspension failed')
  }
  return await res.json()
}

async function confirmSuspension(requestId: string, reason: string): Promise<void> {
  const res = await fetch(`/auth/admin/suspend/${encodeURIComponent(requestId)}/confirm`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Confirmation failed' }))
    throw new Error(data.error || 'Confirmation failed')
  }
}

async function fetchPendingSuspensions(signal?: AbortSignal): Promise<PendingSuspension[]> {
  const res = await fetch('/auth/admin/suspensions/pending', {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error('Failed to load pending suspensions')
  const data = await res.json()
  return data.suspensions
}

export function AdminRevocationSection() {
  const [revokePrincipal, setRevokePrincipal] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [suspendPrincipal, setSuspendPrincipal] = useState('')
  const [suspendReason, setSuspendReason] = useState('')
  const [confirmReason, setConfirmReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const pending = useAsync((signal) => fetchPendingSuspensions(signal), [])

  async function handleRevoke(e: FormEvent) {
    e.preventDefault()
    if (!revokePrincipal.trim() || !revokeReason.trim()) return

    setBusy(true)
    setMessage(null)
    try {
      await revokeUser(revokePrincipal.trim(), revokeReason.trim())
      setMessage({ type: 'success', text: `Revoked all sessions for ${revokePrincipal}` })
      setRevokePrincipal('')
      setRevokeReason('')
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Revocation failed' })
    } finally {
      setBusy(false)
    }
  }

  async function handleSuspend(e: FormEvent) {
    e.preventDefault()
    if (!suspendPrincipal.trim() || !suspendReason.trim()) return

    setBusy(true)
    setMessage(null)
    try {
      const result = await suspendUser(suspendPrincipal.trim(), suspendReason.trim())
      setMessage({ 
        type: 'success', 
        text: `Suspension initiated for ${suspendPrincipal}. Request ID: ${result.requestId}. Requires confirmation within 24h.` 
      })
      setSuspendPrincipal('')
      setSuspendReason('')
      pending.reload()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Suspension failed' })
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm(requestId: string) {
    if (!confirmReason.trim()) {
      setMessage({ type: 'error', text: 'Confirmation reason required' })
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      await confirmSuspension(requestId, confirmReason.trim())
      setMessage({ type: 'success', text: `Suspension ${requestId} confirmed` })
      setConfirmReason('')
      pending.reload()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Confirmation failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="user-revocation" className="settings-section" aria-labelledby="user-revocation-heading">
      <h2 id="user-revocation-heading">
        <Shield size={18} className="button-label-icon" aria-hidden="true" />
        User Revocation
      </h2>
      <p className="muted small">
        Manage user access revocation and emergency suspensions. All actions are audited.
      </p>

      {message && (
        <div className={`flash ${message.type === 'error' ? 'flash-error' : 'flash-success'}`} role="alert">
          {message.text}
        </div>
      )}

      <div className="ns-settings-subsection">
        <h3>Revoke User Access</h3>
        <p className="muted small">
          Immediately revoke all sessions and credentials for a user. This is permanent and cannot be undone.
        </p>
        <form className="ns-member-form" onSubmit={handleRevoke}>
          <div className="ns-settings-grid">
            <label className="ns-settings-field">
              <span className="ns-settings-label">Principal (iss|sub or email)</span>
              <input
                value={revokePrincipal}
                onChange={e => setRevokePrincipal(e.target.value)}
                placeholder="https://idp.example.com|user123 or user@example.com"
                disabled={busy}
                required
              />
            </label>
            <label className="ns-settings-field">
              <span className="ns-settings-label">Reason</span>
              <input
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                placeholder="Security incident #2024-042"
                disabled={busy}
                required
              />
            </label>
          </div>
          <div className="ns-member-form-actions">
            <button 
              className="btn danger" 
              type="submit" 
              disabled={busy || !revokePrincipal.trim() || !revokeReason.trim()}
            >
              {busy ? 'Revoking...' : 'Revoke All Sessions'}
            </button>
          </div>
        </form>
      </div>

      <div className="ns-settings-subsection">
        <h3>
          <AlertTriangle size={16} className="button-label-icon" aria-hidden="true" />
          Emergency Suspension
        </h3>
        <p className="muted small">
          Initiate a security suspension requiring second-admin confirmation within 24 hours. 
          Access is revoked immediately, pending confirmation.
        </p>
        <form className="ns-member-form" onSubmit={handleSuspend}>
          <div className="ns-settings-grid">
            <label className="ns-settings-field">
              <span className="ns-settings-label">Principal (iss|sub or email)</span>
              <input
                value={suspendPrincipal}
                onChange={e => setSuspendPrincipal(e.target.value)}
                placeholder="suspicious.user@example.com"
                disabled={busy}
                required
              />
            </label>
            <label className="ns-settings-field">
              <span className="ns-settings-label">Reason</span>
              <input
                value={suspendReason}
                onChange={e => setSuspendReason(e.target.value)}
                placeholder="Suspected account compromise"
                disabled={busy}
                required
              />
            </label>
          </div>
          <div className="ns-member-form-actions">
            <button 
              className="btn danger" 
              type="submit" 
              disabled={busy || !suspendPrincipal.trim() || !suspendReason.trim()}
            >
              {busy ? 'Suspending...' : 'Initiate Suspension'}
            </button>
          </div>
        </form>
      </div>

      <div className="ns-settings-subsection">
        <h3>Pending Confirmations</h3>
        {pending.kind === 'loading' && <p role="status">Loading pending suspensions...</p>}
        {pending.kind === 'error' && (
          <div className="flash flash-error" role="alert">
            {pending.message}
          </div>
        )}
        {pending.kind === 'ok' && pending.data.length === 0 && (
          <p className="muted small">No pending suspensions.</p>
        )}
        {pending.kind === 'ok' && pending.data.length > 0 && (
          <>
            <p className="muted small">
              {pending.data.length} suspension{pending.data.length === 1 ? '' : 's'} awaiting second-admin confirmation.
            </p>
            <ul className="ns-member-list">
              {pending.data.map(s => (
                <li key={s.id} className="ns-member-row">
                  <div className="ns-member-main">
                    <div>
                      <strong>{s.principal}</strong>
                      <span className="muted small"> · Request: {s.id.slice(0, 16)}...</span>
                    </div>
                    <span className="muted small">
                      Suspended by: {s.suspendedBy}
                      <br />
                      Reason: {s.reason}
                      <br />
                      Expires: {new Date(s.expiresAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="ns-settings-field" style={{ maxWidth: '300px' }}>
                    <label>
                      <span className="ns-settings-label">Confirmation reason</span>
                      <input
                        value={confirmReason}
                        onChange={e => setConfirmReason(e.target.value)}
                        placeholder="Reviewed and approved"
                        required
                      />
                    </label>
                    <button
                      className="btn primary small"
                      type="button"
                      disabled={busy || !confirmReason.trim()}
                      onClick={() => void handleConfirm(s.id)}
                    >
                      Confirm Suspension
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
