import { Monitor, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

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
  const headingId = useId()
  const descId = useId()
  const errorId = useId()
  const [sessions, setSessions] = useState<WebSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function loadSessions(signal?: AbortSignal) {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchWebSessions(signal)
      if (signal?.aborted) return
      setSessions(data)
    } catch (err) {
      if (signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Could not load sessions')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadSessions(ac.signal)
    return () => ac.abort()
  }, [])

  async function handleRevoke(sessionId: string) {
    if (!window.confirm('Sign out this browser session?')) return

    try {
      setRevoking(sessionId)
      setError(null)
      await revokeWebSession(sessionId)
      await loadSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session')
    } finally {
      setRevoking(null)
    }
  }

  const otherSessions =
    currentSessionId != null
      ? sessions.filter((s) => s.id !== currentSessionId)
      : sessions.length > 1
        ? sessions
        : []
  const activeLabel =
    sessions.length === 1 ? '1 active' : `${sessions.length} active`

  return (
    <div
      className="ns-settings-subsection"
      data-testid="web-sessions-list"
      aria-labelledby={headingId}
      aria-describedby={descId}
    >
      <div className="ns-settings-section-head">
        <h3 id={headingId}>
          <Monitor size={16} className="button-label-icon" aria-hidden="true" />
          Web Sessions
          {!loading && !error ? (
            <span className="muted small"> ({activeLabel})</span>
          ) : null}
        </h3>
        <p id={descId} className="muted small">
          Active browser sessions on your account. You can revoke individual sessions.
        </p>
      </div>

      {loading && (
        <p role="status" aria-live="polite">
          Loading web sessions…
        </p>
      )}

      {!loading && error && (
        <div className="flash flash-error" role="alert" id={errorId} tabIndex={-1}>
          <p className="error">{error}</p>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void loadSessions()}
            aria-describedby={errorId}
          >
            <RefreshCw size={14} className="button-label-icon" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true" />
          <p className="muted">No active browser sessions.</p>
          <p className="muted small">Sign in again from another browser to see it listed here.</p>
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <ul className="ns-member-list" aria-labelledby={headingId}>
          {sessions.map((session) => {
            const isCurrent = currentSessionId != null && session.id === currentSessionId
            const shortId = session.id.slice(0, 12)
            const revokeLabel = `Sign out session ${shortId}`

            return (
              <li key={session.id} className="ns-member-row">
                <div className="ns-member-main">
                  {isCurrent ? (
                    <span className="pill ok" role="status">
                      Current session
                    </span>
                  ) : (
                    <span className="mono muted small" title={session.id}>
                      {shortId}…
                    </span>
                  )}
                  <span className="muted small">
                    Started {formatTimeAgo(session.sessionStart)} · Last active{' '}
                    {formatTimeAgo(session.lastActive)}
                  </span>
                </div>
                {!isCurrent && (
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={revoking === session.id}
                    aria-label={revokeLabel}
                    onClick={() => void handleRevoke(session.id)}
                  >
                    <Trash2 size={14} className="button-label-icon" aria-hidden="true" />
                    {revoking === session.id ? 'Signing out…' : 'Sign out this session'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!loading && !error && otherSessions.length > 0 && (
        <p className="muted small">
          Tip: Use &quot;Sign out everywhere&quot; below to revoke all sessions including CLI
          credentials.
        </p>
      )}
    </div>
  )
}
