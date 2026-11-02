import { Laptop, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Lists the signed-in Principal's CLI credentials from `mice login`.
 * Backend: GET /auth/me/tokens, DELETE /auth/me/tokens/:id
 */

export type DeviceSession = {
  id: string
  createdAt: string
  expiresAt: string
}

type TokensResponse = {
  tokens: DeviceSession[]
}

async function fetchDeviceSessions(signal?: AbortSignal): Promise<DeviceSession[]> {
  const res = await fetch('/auth/me/tokens', {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error('Failed to load device sessions')
  const data = (await res.json()) as TokensResponse
  return data.tokens
}

async function revokeDeviceSession(tokenId: string): Promise<void> {
  const res = await fetch(`/auth/me/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error('Failed to revoke device session')
}

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  return `${Math.floor(diff / 86400)} days ago`
}

function formatExpiry(isoString?: string): string {
  if (!isoString) return 'No expiry'
  const date = new Date(isoString)
  const now = new Date()
  const diff = Math.floor((date.getTime() - now.getTime()) / 1000)
  
  if (diff < 0) return 'Expired'
  if (diff < 3600) return `Expires in ${Math.floor(diff / 60)} minutes`
  if (diff < 86400) return `Expires in ${Math.floor(diff / 3600)} hours`
  return `Expires in ${Math.floor(diff / 86400)} days`
}

export function DeviceSessionsList() {
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function loadSessions() {
    try {
      setError(null)
      const data = await fetchDeviceSessions()
      setSessions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load device sessions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions()
  }, [])

  async function handleRevoke(sessionId: string) {
    if (!window.confirm('Revoke this CLI credential? You will need to run "mice login" again.')) return
    
    try {
      setRevoking(sessionId)
      await revokeDeviceSession(sessionId)
      await loadSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke device session')
    } finally {
      setRevoking(null)
    }
  }

  if (loading) {
    return <p role="status">Loading device sessions...</p>
  }

  if (error) {
    return (
      <div className="flash flash-error" role="alert">
        {error}
      </div>
    )
  }

  return (
    <div className="ns-settings-subsection">
      <div className="ns-settings-section-head">
        <h3>
          <Laptop size={16} className="button-label-icon" aria-hidden="true" />
          Device Sessions ({sessions.length} active)
        </h3>
        <p className="muted small">
          CLI credentials created via <code>mice login</code>. Each device gets its own session.
        </p>
      </div>

      {sessions.length === 0 && (
        <p className="muted small">
          No active device sessions. Run <code>mice login</code> to create one.
        </p>
      )}

      {sessions.length > 0 && (
        <ul className="ns-member-list">
          {sessions.map(session => (
            <li key={session.id} className="ns-member-row">
              <div className="ns-member-main">
                <div>
                  <strong>CLI</strong>
                </div>
                <span className="muted small">
                  Created {formatTimeAgo(session.createdAt)}
                  {' · '}
                  {formatExpiry(session.expiresAt)}
                </span>
              </div>
              <button
                className="btn ghost small"
                type="button"
                disabled={revoking === session.id}
                onClick={() => void handleRevoke(session.id)}
              >
                <Trash2 size={14} className="button-label-icon" aria-hidden="true" />
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
