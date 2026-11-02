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
      return <CheckCircle size={16} className="text-green-600" />
    case 'valid':
      return <Clock size={16} className="text-blue-600" />
    case 'expired':
      return <XCircle size={16} className="text-gray-400" />
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
        <div className="alert alert-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="alert alert-success" role="status">
          <CheckCircle size={16} />
          <span>{success}</span>
        </div>
      )}

      {/* Current Key Status */}
      <div className="card">
        <h3>Current Primary Key</h3>
        {currentKey.kind === 'loading' && <p>Loading...</p>}
        {currentKey.kind === 'error' && (
          <p className="text-error">Failed to load current key</p>
        )}
        {currentKey.kind === 'ok' && currentKey.data && (
          <div className="key-info">
            <div className="key-row">
              <span className="key-label">Key ID:</span>
              <code>{currentKey.data.id}</code>
            </div>
            <div className="key-row">
              <span className="key-label">Type:</span>
              <span className="badge">{currentKey.data.rotationType}</span>
            </div>
            <div className="key-row">
              <span className="key-label">Valid From:</span>
              <span>{formatTimestamp(currentKey.data.validFrom)}</span>
            </div>
            <div className="key-row">
              <span className="key-label">Created:</span>
              <span>{new Date(currentKey.data.createdAt).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      {/* Rotation Actions */}
      <div className="card">
        <h3>Key Rotation</h3>
        
        <form onSubmit={handleNormalRotation} className="rotation-form">
          <p className="form-help">
            <strong>Normal Rotation:</strong> Creates a new key and marks the current key to expire in 7 days. 
            Users are not logged out during the overlap period.
          </p>
          <button 
            type="submit" 
            className="btn primary"
            disabled={busy}
          >
            {busy ? 'Rotating...' : 'Perform Normal Rotation'}
          </button>
        </form>

        <hr />

        {!showEmergencyForm ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => setShowEmergencyForm(true)}
          >
            <AlertCircle size={16} />
            Emergency Rotation
          </button>
        ) : (
          <form onSubmit={handleEmergencyRotation} className="rotation-form emergency">
            <p className="form-help text-warning">
              <AlertCircle size={16} />
              <strong>Emergency Rotation:</strong> Immediately revokes the current key with an 8-hour grace period. 
              Use only if the current key is compromised.
            </p>
            <label>
              Reason for emergency rotation:
              <textarea
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                placeholder="e.g., Key potentially compromised..."
                rows={3}
                required
                disabled={busy}
              />
            </label>
            <div className="button-group">
              <button 
                type="submit" 
                className="btn danger"
                disabled={busy || !emergencyReason.trim()}
              >
                {busy ? 'Rotating...' : 'Perform Emergency Rotation'}
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

      {/* Key Ring Status */}
      <div className="card">
        <h3>Key Ring ({keyRing.kind === 'ok' ? keyRing.data.length : '...'} keys)</h3>
        {keyRing.kind === 'loading' && <p>Loading key ring...</p>}
        {keyRing.kind === 'error' && (
          <p className="text-error">Failed to load key ring</p>
        )}
        {keyRing.kind === 'ok' && (
          <div className="key-ring-table">
            <table>
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
                  <tr key={key.id} className={key.isCurrent ? 'current-key' : ''}>
                    <td>
                      <KeyStatusIcon status={key.status} />
                    </td>
                    <td>
                      <code className="key-id-short">{key.id.split('_').pop()}</code>
                      {key.isCurrent && <span className="badge badge-primary">current</span>}
                    </td>
                    <td>
                      <span className={`badge ${key.rotationType === 'emergency' ? 'badge-danger' : ''}`}>
                        {key.rotationType}
                      </span>
                    </td>
                    <td className="text-sm">{formatTimestamp(key.validFrom)}</td>
                    <td className="text-sm">
                      {key.validUntil ? (
                        <>
                          {formatTimestamp(key.validUntil)}
                          <br />
                          <span className="text-muted">{formatRelativeTime(key.validUntil)}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .key-info {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        
        .key-row {
          display: flex;
          gap: 1rem;
          align-items: center;
        }
        
        .key-label {
          font-weight: 500;
          min-width: 100px;
          color: var(--text-secondary);
        }
        
        .rotation-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .rotation-form.emergency {
          padding: 1rem;
          border: 2px solid var(--color-warning);
          border-radius: 8px;
          background: var(--bg-warning-subtle);
        }
        
        .form-help {
          margin: 0;
          font-size: 0.9rem;
          color: var(--text-secondary);
          display: flex;
          align-items: start;
          gap: 0.5rem;
        }
        
        .text-warning {
          color: var(--color-warning);
        }
        
        .button-group {
          display: flex;
          gap: 0.5rem;
        }
        
        .key-ring-table {
          overflow-x: auto;
        }
        
        .key-ring-table table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .key-ring-table th {
          text-align: left;
          padding: 0.75rem;
          border-bottom: 2px solid var(--border-color);
          font-weight: 600;
        }
        
        .key-ring-table td {
          padding: 0.75rem;
          border-bottom: 1px solid var(--border-color);
        }
        
        .key-ring-table tr.current-key {
          background: var(--bg-success-subtle);
        }
        
        .key-id-short {
          font-family: monospace;
          font-size: 0.85rem;
          margin-right: 0.5rem;
        }
        
        .badge {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          background: var(--bg-secondary);
          color: var(--text-primary);
        }
        
        .badge-primary {
          background: var(--color-primary);
          color: white;
        }
        
        .badge-danger {
          background: var(--color-danger);
          color: white;
        }
        
        .text-sm {
          font-size: 0.875rem;
        }
        
        .text-muted {
          color: var(--text-secondary);
        }
        
        .text-error {
          color: var(--color-danger);
        }
        
        .alert {
          padding: 1rem;
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .alert-error {
          background: var(--bg-error-subtle);
          color: var(--color-danger);
          border: 1px solid var(--color-danger);
        }
        
        .alert-success {
          background: var(--bg-success-subtle);
          color: var(--color-success);
          border: 1px solid var(--color-success);
        }
      `}</style>
    </section>
  )
}
