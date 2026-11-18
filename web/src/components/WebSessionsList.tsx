import { Monitor, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { confirmDelete } from '../lib/confirmDelete'

/**
 * Web Browser Session Management (Feature 1)
 *
 * Displays user's active browser sessions with ability to revoke individual sessions.
 * Backend: GET /auth/sessions/web, DELETE /auth/sessions/web/:id
 * Cap: five concurrent web sessions; a sixth sign-in evicts the oldest.
 */

/** Matches auth `WEB_SESSION_CAP` — surface the limit in profile chrome. */
export const WEB_SESSION_CAP = 5

export type WebSession = {
  id: string
  sessionStart: number
  lastActive: number
  /** True when this row is the caller’s cookie session. */
  current?: boolean
  /** Absolute expiry (sessionStart + TTL), epoch seconds. */
  expiresAt?: number
  /** Idle expiry (lastActive + idle), epoch seconds when idle is enabled. */
  idleExpiresAt?: number
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
  if (diff < 3600) {
    const m = Math.floor(diff / 60)
    return m === 1 ? '1 minute ago' : `${m} minutes ago`
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600)
    return h === 1 ? '1 hour ago' : `${h} hours ago`
  }
  const d = Math.floor(diff / 86400)
  return d === 1 ? '1 day ago' : `${d} days ago`
}

function formatExpiresIn(epochSec: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = epochSec - now
  if (diff <= 0) return 'expired'
  if (diff < 60) return 'in under a minute'
  if (diff < 3600) return `in ${Math.floor(diff / 60)} min`
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600)
    const mins = Math.floor((diff % 3600) / 60)
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`
  }
  return `in ${Math.floor(diff / 86400)} days`
}

function formatClock(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function WebSessionsList() {
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
    const ok = await confirmDelete({
      title: 'Sign Out from Web Session',
      detail: `This ends session ${sessionId} on that browser. It will need to sign in again. Your current session stays signed in. This cannot be undone.`,
      requireTypedConfirm: false,
      irreversibleNote: false,
    })
    if (!ok) return

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

  const otherSessions = sessions.filter((s) => !s.current)
  const activeLabel = `${sessions.length} of ${WEB_SESSION_CAP} active`
  const nearCap = !loading && !error && sessions.length >= WEB_SESSION_CAP

  return (
    <div
      id="profile-web-sessions"
      className="ns-settings-subsection"
      data-testid="web-sessions-list"
      aria-labelledby={headingId}
      aria-describedby={descId}
      aria-busy={loading || undefined}
    >
      <div className="ns-settings-section-head">
        <div>
          <h3 id={headingId}>
            <Monitor size={16} className="button-label-icon" aria-hidden="true" />
            Web Sessions
            {!loading && !error ? (
              <span className="muted small" role="status" aria-atomic="true">
                {' '}
                ({activeLabel})
              </span>
            ) : null}
          </h3>
          <p id={descId} className="muted small">
            Active browser sessions on your account (maximum {WEB_SESSION_CAP}). Idle sessions
            expire after 15 minutes; absolute lifetime is 8 hours. You can revoke individual
            sessions. When you are at the cap, signing in from another browser may sign out the
            oldest session automatically.
          </p>
        </div>
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
            const isCurrent = session.current === true
            const revokeLabel = `Sign out session ${session.id}`

            return (
              <li
                key={session.id}
                className="ns-member-row"
                data-current={isCurrent ? 'true' : undefined}
              >
                <div className="ns-member-main">
                  <div className="web-session-title">
                    {isCurrent ? (
                      <span className="status-pill ok" role="status">
                        Current session
                      </span>
                    ) : (
                      <span className="status-pill neutral" role="status">
                        Session
                      </span>
                    )}
                    <code className="inline-code mono muted small" title={session.id}>
                      {session.id}
                    </code>
                  </div>
                  <span className="muted small">
                    Started {formatTimeAgo(session.sessionStart)}
                    {session.sessionStart ? ` (${formatClock(session.sessionStart)})` : ''}
                    {' · '}
                    Last active {formatTimeAgo(session.lastActive)}
                  </span>
                  {(session.expiresAt != null || session.idleExpiresAt != null) && (
                    <span className="muted small" data-testid="web-session-expiry">
                      {session.idleExpiresAt != null ? (
                        <>
                          Idle expires {formatExpiresIn(session.idleExpiresAt)}
                          {' · '}
                        </>
                      ) : null}
                      {session.expiresAt != null ? (
                        <>
                          Absolute expiry {formatExpiresIn(session.expiresAt)} (
                          {formatClock(session.expiresAt)})
                        </>
                      ) : null}
                    </span>
                  )}
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
                    {revoking === session.id ? 'Signing out…' : 'Sign Out'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {nearCap && (
        <p className="flash flash-warn" role="status" data-testid="web-sessions-cap-note">
          <span className="status-pill warn">At limit</span>{' '}
          A new sign-in may evict the oldest browser session (reason: cap exceeded).
        </p>
      )}

      {!loading && !error && otherSessions.length > 0 && (
        <p className="muted small">
          Tip: Use &quot;Sign out everywhere&quot; below to revoke all sessions including CLI
          device credentials.
        </p>
      )}
    </div>
  )
}
