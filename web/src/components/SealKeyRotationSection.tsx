import {
  Key,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  Copy as ActionCopy,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import { authzFetch } from '../lib/authzApi'
import {
  SEAL_KEY_ROTATION_DAYS,
  decideSealKeyScheduleStatus,
} from '../lib/sealKeySchedule'

/**
 * Seal Key Rotation UI (Ticket 03, Ticket 17, Ticket 34)
 *
 * Allows instance admins to:
 * - View current seal key and key ring status
 * - See automatic 30-day schedule status (derived from key validFrom; no schedule API)
 * - Perform normal rotation (30-day schedule, 7-day overlap)
 * - Perform emergency rotation (immediate with 8-hour grace)
 */

type SealKeyInfo = {
  id: string
  validFrom: number
  validUntil: number | null
  revokedAt: number | null
  rotationType: 'normal' | 'emergency'
  createdAt: string
  status: 'valid' | 'expired' | 'current'
  isCurrent?: boolean
}

type SealKeyListResponse = {
  keys: SealKeyInfo[]
}

type SealKeyCurrentResponse = {
  key: SealKeyInfo
}

async function listSealKeys(): Promise<SealKeyInfo[]> {
  const res = await fetch('/auth/admin/seal-keys', {
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error('Failed to fetch seal keys')
  }
  const data: SealKeyListResponse = await res.json()
  return data.keys
}

async function getCurrentSealKey(): Promise<SealKeyInfo> {
  const res = await fetch('/auth/admin/seal-keys/current', {
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error('Failed to fetch current seal key')
  }
  const data: SealKeyCurrentResponse = await res.json()
  return data.key
}

/**
 * Rotation requires a reason + electronic signature (#122). `authzFetch` runs the
 * reason/signing ceremony (`withReason`) when the BFF asks for it, like AdminRevocationSection.
 */
async function performNormalRotation(): Promise<void> {
  await authzFetch('/auth/admin/seal-keys/rotate', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

async function performEmergencyRotation(reason: string): Promise<void> {
  await authzFetch('/auth/admin/seal-keys/rotate/emergency', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

function formatTimestamp(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleString()
}

function formatRelativeTime(epochSec: number): string {
  const now = Date.now() / 1000
  const diff = epochSec - now

  if (diff < 0) {
    return 'expired'
  }

  const days = Math.floor(diff / 86400)
  const hours = Math.floor((diff % 86400) / 3600)

  if (days > 0) {
    return `${days}d ${hours}h remaining`
  }
  return `${hours}h remaining`
}

function KeyStatusIcon({ status }: { status: 'valid' | 'expired' | 'current' }) {
  switch (status) {
    case 'current':
      return <CheckCircle size={14} aria-hidden="true" />
    case 'valid':
      return <Clock size={14} aria-hidden="true" />
    case 'expired':
      return <XCircle size={14} aria-hidden="true" />
  }
}

function CopyKeyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="settings-copy-inline">
      <code className="inline-code settings-copy-value" title={id}>
        {id}
      </code>
      <button type="button" className="settings-copy-btn" onClick={() => void copy()} aria-label="Copy key ID">
        <ActionCopy size={12} aria-hidden="true" />
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}

export function SealKeyRotationSection() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyAction, setBusyAction] = useState<'normal' | 'emergency' | null>(null)
  const [emergencyReason, setEmergencyReason] = useState('')
  const [showEmergencyForm, setShowEmergencyForm] = useState(false)
  const busy = busyAction !== null

  const currentKey = useAsync(() => getCurrentSealKey(), [])
  const keyRing = useAsync(() => listSealKeys(), [])
  const schedule =
    currentKey.kind === 'ok' && currentKey.data
      ? decideSealKeyScheduleStatus(currentKey.data.validFrom)
      : null

  async function handleNormalRotation(e: FormEvent) {
    e.preventDefault()
    if (busy) return

    setBusyAction('normal')
    setError('')
    setSuccess('')

    try {
      await performNormalRotation()
      setSuccess('Normal rotation completed. Old key valid for 7 more days.')
      currentKey.reload()
      keyRing.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rotation failed')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleEmergencyRotation(e: FormEvent) {
    e.preventDefault()
    if (busy || !emergencyReason.trim()) return

    setBusyAction('emergency')
    setError('')
    setSuccess('')

    try {
      await performEmergencyRotation(emergencyReason)
      setSuccess('Emergency rotation completed. Old key revoked with 8-hour grace period.')
      setEmergencyReason('')
      setShowEmergencyForm(false)
      currentKey.reload()
      keyRing.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Emergency rotation failed')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section id="seal-key-rotation" className="settings-section" aria-labelledby="seal-key-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="seal-key-heading">
            <Key size={18} className="button-label-icon" aria-hidden="true" />
            Session cookie keys
          </h2>
          <p className="muted small">
            AES-256-GCM seal keys for session cookies. Normal: {SEAL_KEY_ROTATION_DAYS}-day schedule,
            7-day overlap. Emergency: immediate revoke with 8-hour grace.
          </p>
        </div>
        {schedule ? (
          <span
            className={`status-pill ${schedule.due ? 'warn' : 'ok'}`}
            role="status"
            aria-label={schedule.due ? 'Automatic rotation due' : 'Automatic rotation on schedule'}
          >
            {schedule.due ? 'Due now' : 'On schedule'}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="flash flash-success" role="status">
          {success}
        </p>
      ) : null}

      <h3 className="ns-settings-subhead">Current Primary Key</h3>
      {currentKey.kind === 'loading' ? (
        <p className="muted small" role="status" aria-live="polite">
          Loading current key…
        </p>
      ) : null}
      {currentKey.kind === 'error' ? (
        <div className="flash flash-error" role="alert">
          <p>Failed to load current key</p>
          <button type="button" className="btn ghost" onClick={() => currentKey.reload()}>
            Try again
          </button>
        </div>
      ) : null}
      {currentKey.kind === 'ok' && currentKey.data ? (
        <dl className="ns-settings-facts" aria-label="Current primary seal key">
          <div className="ns-settings-fact ns-settings-fact-wide ns-settings-fact-stack">
            <dt className="ns-settings-fact-label">Key ID</dt>
            <dd className="ns-settings-fact-value">
              <CopyKeyId id={currentKey.data.id} />
            </dd>
          </div>
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Type</dt>
            <dd className="ns-settings-fact-value" role="status">
              <span
                className={
                  currentKey.data.rotationType === 'emergency' ? 'status-pill warn' : 'status-pill ok'
                }
              >
                {currentKey.data.rotationType}
              </span>
            </dd>
          </div>
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Status</dt>
            <dd className="ns-settings-fact-value" role="status">
              <span className="status-pill active">{currentKey.data.status}</span>
            </dd>
          </div>
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Valid from</dt>
            <dd className="ns-settings-fact-value">{formatTimestamp(currentKey.data.validFrom)}</dd>
          </div>
          <div className="ns-settings-fact">
            <dt className="ns-settings-fact-label">Created</dt>
            <dd className="ns-settings-fact-value">
              {new Date(currentKey.data.createdAt).toLocaleString()}
            </dd>
          </div>
        </dl>
      ) : null}

      <h3 className="ns-settings-subhead">Automatic rotation schedule</h3>
      {schedule ? (
        <div
          className={schedule.due ? 'flash flash-warn' : 'flash flash-info'}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="seal-key-schedule-status"
        >
          <p className="ns-settings-fact-note">
            <Clock size={14} aria-hidden="true" className="button-label-icon" />
            {schedule.summary}
          </p>
          <dl className="ns-settings-facts">
            <div className="ns-settings-fact">
              <dt className="ns-settings-fact-label">Schedule basis (key issued)</dt>
              <dd className="ns-settings-fact-value">
                <time dateTime={new Date(schedule.lastScheduledFrom * 1000).toISOString()}>
                  {formatTimestamp(schedule.lastScheduledFrom)}
                </time>
              </dd>
            </div>
            <div className="ns-settings-fact">
              <dt className="ns-settings-fact-label">Next eligible automatic run</dt>
              <dd className="ns-settings-fact-value">
                <time dateTime={new Date(schedule.nextEligibleAt * 1000).toISOString()}>
                  {formatTimestamp(schedule.nextEligibleAt)}
                </time>
                {schedule.due ? <span className="status-pill warn">due now</span> : null}
              </dd>
            </div>
          </dl>
          <p className="muted small">
            Checks about once a minute; restart does not reset the {SEAL_KEY_ROTATION_DAYS}-day wait.
            Manual normal rotation is always available below.
          </p>
        </div>
      ) : (
        <p className="muted small" role="status" aria-live="polite">
          Load the current primary key to see the {SEAL_KEY_ROTATION_DAYS}-day automatic rotation
          schedule.
        </p>
      )}

      <h3 className="ns-settings-subhead">Key Rotation</h3>
      <form onSubmit={handleNormalRotation} className="ns-member-form">
        <p className="muted small">
          <strong>Normal Rotation:</strong> New key; current expires in 7 days. No logout during overlap.
        </p>
        <div className="btn-row ns-settings-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {busyAction === 'normal' ? 'Rotating…' : 'Perform Normal Rotation'}
          </button>
        </div>
      </form>

      {!showEmergencyForm ? (
        <div className="btn-row ns-settings-actions">
          <button type="button" className="btn ghost" onClick={() => setShowEmergencyForm(true)}>
            <AlertCircle size={16} aria-hidden="true" className="button-label-icon" />
            Emergency Rotation
          </button>
        </div>
      ) : (
        <form onSubmit={handleEmergencyRotation} className="ns-member-form">
          <p className="flash flash-warn" role="status">
            <AlertCircle size={16} aria-hidden="true" className="button-label-icon" />
            <strong>Emergency Rotation:</strong> Immediate revoke with 8-hour grace. Use only if
            compromised.
          </p>
          <label className="ns-settings-field" htmlFor="seal-key-emergency-reason">
            <span className="ns-settings-label">Reason for emergency rotation</span>
            <textarea
              id="seal-key-emergency-reason"
              value={emergencyReason}
              onChange={(e) => setEmergencyReason(e.target.value)}
              placeholder="e.g., Key potentially compromised..."
              rows={3}
              required
              disabled={busy}
            />
          </label>
          <div className="btn-row ns-settings-actions">
            <button
              type="submit"
              className="btn danger"
              disabled={busy || !emergencyReason.trim()}
            >
              {busyAction === 'emergency' ? 'Emergency rotating…' : 'Perform Emergency Rotation'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setShowEmergencyForm(false)
                setEmergencyReason('')
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <h3 className="ns-settings-subhead">
        Key Ring ({keyRing.kind === 'ok' ? keyRing.data.length : '…'} keys)
      </h3>
      {keyRing.kind === 'loading' ? (
        <p className="muted small" role="status" aria-live="polite">
          Loading key ring…
        </p>
      ) : null}
      {keyRing.kind === 'error' ? (
        <div className="flash flash-error" role="alert">
          <p>Failed to load key ring</p>
          <button type="button" className="btn ghost" onClick={() => keyRing.reload()}>
            Try again
          </button>
        </div>
      ) : null}
      {keyRing.kind === 'ok' && keyRing.data.length === 0 ? (
        <div className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true" />
          <p className="muted">No seal keys in the ring.</p>
          <p className="muted small">Bootstrap or rotate a key to populate the ring.</p>
        </div>
      ) : null}
      {keyRing.kind === 'ok' && keyRing.data.length > 0 ? (
        <ul className="ns-member-list" data-testid="seal-key-ring" aria-label="Seal key ring">
          {keyRing.data.map((key) => (
            <li
              key={key.id}
              className="ns-member-row"
              data-testid={key.isCurrent ? 'seal-key-ring-current' : undefined}
            >
              <div className="ns-member-main">
                <span className="settings-copy-inline">
                  <KeyStatusIcon status={key.status} />
                  <code className="inline-code" title={key.id}>
                    {key.id.split('_').pop()}
                  </code>
                </span>
                <span className="muted small">
                  {formatTimestamp(key.validFrom)}
                  {key.validUntil
                    ? ` · expires ${formatTimestamp(key.validUntil)} (${formatRelativeTime(key.validUntil)})`
                    : ''}
                </span>
              </div>
              <span
                className={
                  key.rotationType === 'emergency' ? 'status-pill warn' : 'status-pill neutral'
                }
              >
                {key.rotationType}
              </span>
              {key.isCurrent ? <span className="status-pill active">current</span> : null}
              <span
                className={
                  key.status === 'expired'
                    ? 'status-pill bad'
                    : key.status === 'current'
                      ? 'status-pill ok'
                      : 'status-pill neutral'
                }
              >
                {key.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
