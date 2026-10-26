import { Monitor, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Web Browser Session Management (Feature 1)
 * 
 * Displays user's active browser sessions with ability to revoke individual sessions.
 * Backend: GET /auth/sessions/web, DELETE /auth/sessions/web/:id
 */

export type WebSession = {
  id: string
  sessionStart: number
  lastActive: number
}

type WebSessionsResponse = {
  sessions: WebSession[]
}

async function fetchWebSessions(signal?: AbortSignal): Promise<WebSession[]> {
  const res = await fetch('/auth/sessions/web', {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error('Failed to load sessions')
  const data = (await res.json()) as WebSessionsResponse
  return data.sessions
}

async function revokeWebSession(sessionId: string): Promise<void> {
  const res = await fetch(`/auth/sessions/web/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error('Failed to revoke session')
}

function formatTimeAgo(epochSec: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - epochSec
  
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  return `${Math.floor(diff / 86400)} days ago`
}

export function WebSessionsList({ currentSessionId }: { currentSessionId?: string }) {
  const [sessions, setSessions] = useState<WebSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function loadSessions() {
    try {
      setError(null)
      const data = await fetchWebSessions()
      setSessions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load sessions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSessions()
  }, [])

  async function handleRevoke(sessionId: string) {
    if (!window.confirm('Sign out this browser session?')) return
    
    try {
      setRevoking(sessionId)
      await revokeWebSession(sessionId)
      await loadSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session')
    } finally {
      setRevoking(null)
    }
  }

  if (loading) {
    return <p role="status">Loading sessions...</p>
  }

  if (error) {
    return (
      <div className="flash flash-error" role="alert">
        {error}
      </div>
    )
  }

  const otherSessions = sessions.filter(s => s.id !== currentSessionId)

  return (
    <div className="ns-settings-subsection">
      <div className="ns-settings-section-head">
        <h3>
          <Monitor size={16} className="button-label-icon" aria-hidden="true" />
          Web Sessions ({sessions.length} active)
        </h3>
        <p className="muted small">
          Active browser sessions on your account. You can revoke individual sessions.
        </p>
      </div>

      {sessions.length === 0 && (
        <p className="muted small">No active sessions.</p>
      )}

      <ul className="ns-member-list">
        {sessions.map(session => {
          const isCurrent = session.id === currentSessionId
          
          return (
            <li key={session.id} className="ns-member-row">
              <div className="ns-member-main">
                {isCurrent && <span className="badge">🟢 Current session</span>}
                {!isCurrent && <span className="mono muted small">{session.id.slice(0, 12)}...</span>}
                <span className="muted small">
                  Started {formatTimeAgo(session.sessionStart)} · 
                  Last active {formatTimeAgo(session.lastActive)}
                </span>
              </div>
              {!isCurrent && (
                <button
                  className="btn ghost small"
                  type="button"
                  disabled={revoking === session.id}
                  onClick={() => void handleRevoke(session.id)}
                >
                  <Trash2 size={14} className="button-label-icon" aria-hidden="true" />
                  Sign out this session
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {otherSessions.length > 0 && (
        <div className="muted small">
          <p>
            Tip: Use "Sign out everywhere" below to revoke all sessions including CLI credentials.
          </p>
        </div>
      )}
    </div>
  )
}
