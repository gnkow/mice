import { AlertTriangle, Ban, Clock, Shield } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  CHANGE_CONTROL_HEADER,
  REASON_CATEGORY_HEADER,
  REASON_HEADER,
  SIGNATURE_HEADER,
  withReason,
  type ReasonSubmission,
} from '../lib/reason'

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

function ceremonyHeaders(submission?: ReasonSubmission): HeadersInit {
  if (!submission) return { 'Content-Type': 'application/json' }
  return {
    'Content-Type': 'application/json',
    [REASON_HEADER]: submission.reason,
    [REASON_CATEGORY_HEADER]: submission.category,
    [SIGNATURE_HEADER]: submission.signatureId,
    ...(submission.changeControlId
      ? { [CHANGE_CONTROL_HEADER]: submission.changeControlId }
      : {}),
  }
}

async function revokeUser(principal: string, reason: string): Promise<void> {
  const path = '/auth/admin/revoke'
  const body = { principal, reason }
  const res = await withReason(
    (submission) =>
      fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: ceremonyHeaders(submission),
        body: JSON.stringify(body),
      }),
    { method: 'POST', path, body, changeSummary: `Revoke all sessions for ${principal}` },
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Revocation failed' }))
    throw new Error(data.error || 'Revocation failed')
  }
}

async function suspendUser(principal: string, reason: string): Promise<{ requestId: string }> {
  const path = '/auth/admin/suspend'
  const body = { principal, reason }
  const res = await withReason(
    (submission) =>
      fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: ceremonyHeaders(submission),
        body: JSON.stringify(body),
      }),
    { method: 'POST', path, body, changeSummary: `Suspend ${principal}` },
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Suspension failed' }))
    throw new Error(data.error || 'Suspension failed')
  }
  return await res.json()
}

async function confirmSuspension(requestId: string, reason: string): Promise<void> {
  const path = `/auth/admin/suspend/${encodeURIComponent(requestId)}/confirm`
  const body = { reason }
  const res = await withReason(
    (submission) =>
      fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: ceremonyHeaders(submission),
        body: JSON.stringify(body),
      }),
    { method: 'POST', path, body, changeSummary: `Confirm suspension ${requestId}` },
  )
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
  const [confirmReasons, setConfirmReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const pending = useAsync((signal) => fetchPendingSuspensions(signal), [])

  function confirmReasonFor(id: string): string {
    return confirmReasons[id] ?? ''
  }

  function setConfirmReasonFor(id: string, value: string) {
    setConfirmReasons((prev) => ({ ...prev, [id]: value }))
  }

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
        text: `Suspension initiated for ${suspendPrincipal}. Request ID: ${result.requestId}. Requires confirmation within 24h.`,
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
    const reason = confirmReasonFor(requestId).trim()
    if (!reason) {
      setMessage({ type: 'error', text: 'Confirmation reason required' })
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      await confirmSuspension(requestId, reason)
      setMessage({ type: 'success', text: `Suspension ${requestId} confirmed` })
      setConfirmReasons((prev) => {
        const next = { ...prev }
        delete next[requestId]
        return next
      })
      pending.reload()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Confirmation failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      id="user-revocation"
      className="settings-section"
      aria-labelledby="user-revocation-heading"
      data-testid="admin-revocation"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="user-revocation-heading">
            <Shield size={18} className="button-label-icon" aria-hidden="true" />
            User Revocation
          </h2>
          <p className="muted small">
            Manage user access revocation and emergency suspensions. All actions are audited.
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`flash ${message.type === 'error' ? 'flash-error' : 'flash-success'}`}
          role={message.type === 'error' ? 'alert' : 'status'}
          data-testid="admin-revocation-flash"
        >
          {message.text}
        </div>
      )}

      <div className="ns-settings-subsection" data-testid="admin-revoke-form">
        <div className="ns-settings-section-head">
          <div>
            <h3>
              <Ban size={16} className="button-label-icon" aria-hidden="true" />
              Revoke User Access
            </h3>
            <p className="muted small">
              Immediately end all sessions and credentials for a Principal. Permanent — blocks a
              fresh login until an admin restores access elsewhere.
            </p>
          </div>
        </div>
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
              {busy ? 'Revoking…' : 'Revoke All Sessions'}
            </button>
          </div>
        </form>
      </div>

      <div className="ns-settings-subsection" data-testid="admin-suspend-form">
        <div className="ns-settings-section-head">
          <div>
            <h3>
              <AlertTriangle size={16} className="button-label-icon" aria-hidden="true" />
              Emergency Suspension
            </h3>
            <p className="muted small">
              Open a 24-hour request that a different instance admin must confirm. Access is not
              cut until confirmation; unconfirmed requests lapse.
            </p>
          </div>
        </div>
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
              {busy ? 'Suspending…' : 'Initiate Suspension'}
            </button>
          </div>
        </form>
      </div>

      <div className="ns-settings-subsection" data-testid="admin-pending-suspensions">
        <div className="ns-settings-section-head">
          <div>
            <h3>
              <Clock size={16} className="button-label-icon" aria-hidden="true" />
              Pending Confirmations
            </h3>
            <p className="muted small">
              Second-admin confirmations for emergency suspensions (24-hour window).
            </p>
          </div>
        </div>
        {pending.kind === 'loading' && (
          <p role="status" aria-live="polite">Loading pending suspensions…</p>
        )}
        {pending.kind === 'error' && (
          <div className="flash flash-error" role="alert">
            <p>{pending.message}</p>
            <button type="button" className="btn ghost" onClick={() => pending.reload()}>
              Try again
            </button>
          </div>
        )}
        {pending.kind === 'ok' && pending.data.length === 0 && (
          <div className="empty-state" role="status">
            <Clock size={28} className="empty-state-icon-lucide" aria-hidden="true" />
            <p className="muted">No pending suspensions.</p>
            <p className="muted small">
              Emergency suspensions awaiting second-admin confirmation will appear here.
            </p>
          </div>
        )}
        {pending.kind === 'ok' && pending.data.length > 0 && (
          <>
            <p className="muted small ns-settings-count">
              {pending.data.length} suspension{pending.data.length === 1 ? '' : 's'} awaiting
              second-admin confirmation.
            </p>
            <ul className="ns-member-list">
              {pending.data.map(s => (
                <li key={s.id} className="ns-member-row" data-testid="pending-suspension-row">
                  <div className="ns-member-main">
                    <div>
                      <strong>{s.principal}</strong>
                      <span className="muted small"> · Request: {s.id.slice(0, 16)}…</span>
                    </div>
                    <span className="muted small">
                      Requested by: {s.suspendedBy}
                      <br />
                      Reason: {s.reason}
                      <br />
                      Expires: {new Date(s.expiresAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="ns-settings-field admin-confirm-field">
                    <label>
                      <span className="ns-settings-label">Confirmation reason</span>
                      <input
                        value={confirmReasonFor(s.id)}
                        onChange={e => setConfirmReasonFor(s.id, e.target.value)}
                        placeholder="Reviewed and approved"
                        required
                        aria-label={`Confirmation reason for ${s.principal}`}
                      />
                    </label>
                    <button
                      className="btn primary small"
                      type="button"
                      disabled={busy || !confirmReasonFor(s.id).trim()}
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
