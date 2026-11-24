import { AlertTriangle, Ban, Clock, Shield } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import {
  CHANGE_CONTROL_HEADER,
  REASON_HEADER,
  SIGNATURE_HEADER,
  withReason,
  type ReasonSubmission,
} from '../lib/reason'
import { DirectoryPicker } from './DirectoryPicker'

/**
 * Feature 5: Admin Revocation UI
 *
 * Allows admins to revoke user access and manage suspensions.
 * Backend: /auth/admin/revoke, /auth/admin/suspend, /auth/admin/suspensions/pending
 * GxP #121 — mutations run through the electronic signature ceremony (`withReason`).
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

const REASON_MIN = 10

function principalKey(iss: string, sub: string): string {
  const i = iss.trim()
  const s = sub.trim()
  return i && s ? `${i}|${s}` : ''
}

export function AdminRevocationSection({ signedInIss }: { signedInIss: string }) {
  const [revokeSub, setRevokeSub] = useState('')
  const [revokeIss, setRevokeIss] = useState(signedInIss)
  const [revokeReason, setRevokeReason] = useState('')
  const [suspendSub, setSuspendSub] = useState('')
  const [suspendIss, setSuspendIss] = useState(signedInIss)
  const [suspendReason, setSuspendReason] = useState('')
  const [confirmReasons, setConfirmReasons] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<'revoke' | 'suspend' | 'confirm' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  )
  const flashRef = useRef<HTMLDivElement>(null)
  const flashTitleId = useId()

  const pending = useAsync((signal) => fetchPendingSuspensions(signal), [])
  const busy = busyAction !== null
  const revokePrincipal = principalKey(revokeIss || signedInIss, revokeSub)
  const suspendPrincipal = principalKey(suspendIss || signedInIss, suspendSub)

  useEffect(() => {
    if (!message || message.type !== 'error') return
    const t = window.setTimeout(() => flashRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [message])

  function confirmReasonFor(id: string): string {
    return confirmReasons[id] ?? ''
  }

  function setConfirmReasonFor(id: string, value: string) {
    setConfirmReasons((prev) => ({ ...prev, [id]: value }))
  }

  async function handleRevoke(e: FormEvent) {
    e.preventDefault()
    if (!revokePrincipal || revokeReason.trim().length < REASON_MIN) return

    setBusyAction('revoke')
    setMessage(null)
    try {
      await revokeUser(revokePrincipal, revokeReason.trim())
      setMessage({ type: 'success', text: `Revoked all sessions for ${revokePrincipal}` })
      setRevokeSub('')
      setRevokeIss(signedInIss)
      setRevokeReason('')
    } catch (err) {
      if (isCeremonyCancelled(err)) return
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Revocation failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSuspend(e: FormEvent) {
    e.preventDefault()
    if (!suspendPrincipal || suspendReason.trim().length < REASON_MIN) return

    setBusyAction('suspend')
    setMessage(null)
    try {
      const result = await suspendUser(suspendPrincipal, suspendReason.trim())
      setMessage({
        type: 'success',
        text: `Suspension initiated for ${suspendPrincipal}. Request ID: ${result.requestId}. Requires confirmation within 24h.`,
      })
      setSuspendSub('')
      setSuspendIss(signedInIss)
      setSuspendReason('')
      pending.reload()
    } catch (err) {
      if (isCeremonyCancelled(err)) return
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Suspension failed' })
    } finally {
      setBusyAction(null)
    }
  }

  async function handleConfirm(requestId: string) {
    const reason = confirmReasonFor(requestId).trim()
    if (reason.length < REASON_MIN) {
      setMessage({
        type: 'error',
        text: `Confirmation reason must be at least ${REASON_MIN} characters`,
      })
      return
    }

    setBusyAction('confirm')
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
      if (isCeremonyCancelled(err)) return
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Confirmation failed' })
    } finally {
      setBusyAction(null)
    }
  }

  const revokeReady = Boolean(revokePrincipal) && revokeReason.trim().length >= REASON_MIN
  const suspendReady = Boolean(suspendPrincipal) && suspendReason.trim().length >= REASON_MIN

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
            Revoke sessions or open emergency suspensions. Each action opens the electronic
            signature ceremony and is audited.
          </p>
        </div>
      </div>

      {message ? (
        <div
          ref={flashRef}
          className={`flash ${message.type === 'error' ? 'flash-error' : 'flash-success'}`}
          role={message.type === 'error' ? 'alert' : 'status'}
          tabIndex={message.type === 'error' ? -1 : undefined}
          aria-labelledby={message.type === 'error' ? flashTitleId : undefined}
          data-testid="admin-revocation-flash"
        >
          {message.type === 'error' ? (
            <h3 id={flashTitleId} className="reason-prompt-heading">
              There is a problem
            </h3>
          ) : null}
          <p>{message.text}</p>
        </div>
      ) : null}

      <div className="ns-settings-subsection" data-testid="admin-revoke-form">
        <div className="ns-settings-section-head">
          <div>
            <h3>
              <Ban size={16} className="button-label-icon" aria-hidden="true" />
              Revoke User Access
            </h3>
            <p className="muted small">
              End all sessions for a Principal. Submit opens the signing ceremony.
            </p>
          </div>
        </div>
        <form className="ns-member-form" onSubmit={handleRevoke}>
          <div className="ns-settings-grid">
            <div className="ns-settings-field">
              <DirectoryPicker
                kind="user"
                sub={revokeSub}
                iss={revokeIss || signedInIss}
                defaultIss={signedInIss}
                disabled={busy}
                onChange={({ sub, iss }) => {
                  setRevokeSub(sub)
                  setRevokeIss(iss)
                }}
              />
            </div>
            <label className="ns-settings-field">
              <span className="ns-settings-label">Reason</span>
              <input
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Security incident #2024-042"
                disabled={busy}
                required
                minLength={REASON_MIN}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="ns-member-form-actions">
            <button
              className="btn danger"
              type="submit"
              disabled={busy || !revokeReady}
            >
              {busyAction === 'revoke' ? 'Revoking…' : 'Revoke All Sessions'}
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
              Open a 24-hour request another instance admin must confirm. Access is cut only after
              confirmation.
            </p>
          </div>
        </div>
        <form className="ns-member-form" onSubmit={handleSuspend}>
          <div className="ns-settings-grid">
            <div className="ns-settings-field">
              <DirectoryPicker
                kind="user"
                sub={suspendSub}
                iss={suspendIss || signedInIss}
                defaultIss={signedInIss}
                disabled={busy}
                onChange={({ sub, iss }) => {
                  setSuspendSub(sub)
                  setSuspendIss(iss)
                }}
              />
            </div>
            <label className="ns-settings-field">
              <span className="ns-settings-label">Reason</span>
              <input
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Suspected account compromise"
                disabled={busy}
                required
                minLength={REASON_MIN}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="ns-member-form-actions">
            <button
              className="btn danger"
              type="submit"
              disabled={busy || !suspendReady}
            >
              {busyAction === 'suspend' ? 'Suspending…' : 'Initiate Suspension'}
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
              Second-admin confirmations for emergency suspensions (24-hour window). Confirm also
              requires a signature.
            </p>
          </div>
        </div>
        {pending.kind === 'loading' && (
          <p role="status" aria-live="polite">
            Loading pending suspensions…
          </p>
        )}
        {pending.kind === 'error' && (
          <div className="flash flash-error" role="alert">
            <h3 className="reason-prompt-heading">There is a problem</h3>
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
            <p className="muted small ns-settings-count" role="status" aria-live="polite">
              {pending.data.length} suspension{pending.data.length === 1 ? '' : 's'} awaiting
              second-admin confirmation.
            </p>
            <ul className="ns-member-list">
              {pending.data.map((s) => (
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
                        onChange={(e) => setConfirmReasonFor(s.id, e.target.value)}
                        placeholder="Reviewed and approved"
                        required
                        minLength={REASON_MIN}
                        aria-label={`Confirmation reason for ${s.principal}`}
                      />
                    </label>
                    <button
                      className="btn primary small"
                      type="button"
                      disabled={
                        busy || confirmReasonFor(s.id).trim().length < REASON_MIN
                      }
                      onClick={() => void handleConfirm(s.id)}
                    >
                      {busyAction === 'confirm' ? 'Confirming…' : 'Confirm Suspension'}
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
