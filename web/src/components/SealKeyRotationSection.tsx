import { Key, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'

/**
 * Seal Key Rotation UI (Ticket 03, Ticket 17)
 *
 * Allows instance admins to:
 * - View current seal key and key ring status
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

async function performNormalRotation(): Promise<void> {
  const res = await fetch('/auth/admin/seal-keys/rotate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Rotation failed' }))
    throw new Error(data.error || 'Normal rotation failed')
  }
}

async function performEmergencyRotation(reason: string): Promise<void> {
  const res = await fetch('/auth/admin/seal-keys/rotate/emergency', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Emergency rotation failed' }))
    throw new Error(data.error || 'Emergency rotation failed')
  }
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
      return <CheckCircle size={16} aria-hidden="true" />
    case 'valid':
      return <Clock size={16} aria-hidden="true" />
    case 'expired':
      return <XCircle size={16} aria-hidden="true" />
  }
}

export function SealKeyRotationSection() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [emergencyReason, setEmergencyReason] = useState('')
  const [showEmergencyForm, setShowEmergencyForm] = useState(false)

  const currentKey = useAsync(() => getCurrentSealKey(), [])
  const keyRing = useAsync(() => listSealKeys(), [])

  async function handleNormalRotation(e: FormEvent) {
    e.preventDefault()
    if (busy) return

    setBusy(true)
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
      setBusy(false)
    }
  }

  async function handleEmergencyRotation(e: FormEvent) {
    e.preventDefault()
    if (busy || !emergencyReason.trim()) return

    setBusy(true)
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
      setBusy(false)
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
            Seal keys encrypt session cookies using AES-256-GCM. Normal rotation happens on a 30-day schedule
            with 7-day overlap (no user logout). Emergency rotation revokes the current key immediately with
            8-hour grace period.
          </p>
        </div>
      </div>

      {error && (
        <p className="flash flash-error" role="alert">{error}</p>
      )}

      {success && (
        <p className="flash flash-success" role="status">{success}</p>
      )}

      <div className="ns-settings-subsection">
        <h3>Current Primary Key</h3>
        {currentKey.kind === 'loading' && (
          <p role="status" aria-live="polite">Loading current key…</p>
        )}
        {currentKey.kind === 'error' && (
          <div className="flash flash-error" role="alert">
            <p>Failed to load current key</p>
            <button type="button" className="btn ghost" onClick={() => currentKey.reload()}>
              Try again
            </button>
          </div>
        )}
        {currentKey.kind === 'ok' && currentKey.data && (
          <div className="ns-settings-grid">
            <div className="ns-settings-field">
              <span className="ns-settings-label">Key ID</span>
              <p className="muted small"><code className="inline-code">{currentKey.data.id}</code></p>
            </div>
            <div className="ns-settings-field">
              <span className="ns-settings-label">Type</span>
              <p className="muted small">{currentKey.data.rotationType}</p>
            </div>
            <div className="ns-settings-field">
              <span className="ns-settings-label">Valid From</span>
              <p className="muted small">{formatTimestamp(currentKey.data.validFrom)}</p>
            </div>
            <div className="ns-settings-field">
              <span className="ns-settings-label">Created</span>
              <p className="muted small">{new Date(currentKey.data.createdAt).toLocaleString()}</p>
            </div>
          </div>
        )}
      </div>

      <div className="ns-settings-subsection">
        <h3>Key Rotation</h3>

        <form onSubmit={handleNormalRotation} className="ns-member-form">
          <p className="muted small">
            <strong>Normal Rotation:</strong> Creates a new key and marks the current key to expire in 7 days.
            Users are not logged out during the overlap period.
          </p>
          <div className="btn-row ns-settings-actions">
            <button
              type="submit"
              className="btn primary"
              disabled={busy}
            >
              {busy ? 'Rotating…' : 'Perform Normal Rotation'}
            </button>
          </div>
        </form>

        {!showEmergencyForm ? (
          <div className="btn-row ns-settings-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowEmergencyForm(true)}
            >
              <AlertCircle size={16} aria-hidden="true" className="button-label-icon" />
              Emergency Rotation
            </button>
          </div>
        ) : (
          <form onSubmit={handleEmergencyRotation} className="ns-member-form">
            <p className="flash flash-warn" role="status">
              <AlertCircle size={16} aria-hidden="true" className="button-label-icon" />
              <strong>Emergency Rotation:</strong> Immediately revokes the current key with an 8-hour grace period.
              Use only if the current key is compromised.
            </p>
            <label className="ns-settings-field">
              <span className="ns-settings-label">Reason for emergency rotation</span>
              <textarea
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
                {busy ? 'Rotating…' : 'Perform Emergency Rotation'}
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
      </div>

      <div className="ns-settings-subsection">
        <h3>Key Ring ({keyRing.kind === 'ok' ? keyRing.data.length : '…'} keys)</h3>
        {keyRing.kind === 'loading' && (
          <p role="status" aria-live="polite">Loading key ring…</p>
        )}
        {keyRing.kind === 'error' && (
          <div className="flash flash-error" role="alert">
            <p>Failed to load key ring</p>
            <button type="button" className="btn ghost" onClick={() => keyRing.reload()}>
              Try again
            </button>
          </div>
        )}
        {keyRing.kind === 'ok' && keyRing.data.length === 0 && (
          <div className="empty-state" role="status">
            <span className="empty-state-icon" aria-hidden="true" />
            <p className="muted">No seal keys in the ring.</p>
            <p className="muted small">Bootstrap or rotate a key to populate the ring.</p>
          </div>
        )}
        {keyRing.kind === 'ok' && keyRing.data.length > 0 && (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Key ID</th>
                  <th>Type</th>
                  <th>Valid From</th>
                  <th>Expires / Grace Period</th>
                </tr>
              </thead>
              <tbody>
                {keyRing.data.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <KeyStatusIcon status={key.status} />
                      <span className="visually-hidden">{key.status}</span>
                    </td>
                    <td>
                      <code className="inline-code">{key.id.split('_').pop()}</code>
                      {key.isCurrent && <span className="pill">current</span>}
                    </td>
                    <td>{key.rotationType}</td>
                    <td className="muted small">{formatTimestamp(key.validFrom)}</td>
                    <td className="muted small">
                      {key.validUntil ? (
                        <>
                          {formatTimestamp(key.validUntil)}
                          <br />
                          {formatRelativeTime(key.validUntil)}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
