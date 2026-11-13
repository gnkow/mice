import { Laptop, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

/**
 * Lists the signed-in Principal's short-lived CLI device credentials from `mice login`.
 * Backend: GET /auth/me/tokens, DELETE /auth/me/tokens/:id
 * Does not mint personal access tokens — device approval issues rotating CLI credentials only.
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
  if (!res.ok) throw new Error('Failed to load device credentials')
  const data = (await res.json()) as TokensResponse
  return data.tokens
}

async function revokeDeviceSession(tokenId: string): Promise<void> {
  const res = await fetch(`/auth/me/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error('Failed to revoke device credential')
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
  const headingId = useId()
  const descId = useId()
  const errorId = useId()
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  async function loadSessions(signal?: AbortSignal) {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchDeviceSessions(signal)
      if (signal?.aborted) return
      setSessions(data)
    } catch (err) {
      if (signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Could not load device credentials')
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
    if (
      !window.confirm(
        'Revoke this CLI device credential? You will need to run "mice login" again on that device.',
      )
    ) {
      return
    }

    try {
      setRevoking(sessionId)
      setError(null)
      await revokeDeviceSession(sessionId)
      await loadSessions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke device credential')
    } finally {
      setRevoking(null)
    }
  }

  const activeLabel =
    sessions.length === 1 ? '1 active' : `${sessions.length} active`

  return (
    <div
      className="ns-settings-subsection"
      data-testid="cli-device-credentials"
      aria-labelledby={headingId}
      aria-describedby={descId}
    >
      <div className="ns-settings-section-head">
        <h3 id={headingId}>
          <Laptop size={16} className="button-label-icon" aria-hidden="true" />
          CLI device credentials
          {!loading && !error ? (
            <span className="muted small"> ({activeLabel})</span>
          ) : null}
        </h3>
        <p id={descId} className="muted small">
          Short-lived credentials from <code>mice login</code> (device approval): an 8-hour
          access token with a rotating refresh token. This page does not mint personal access
          tokens — list and revoke device credentials here.
        </p>
      </div>

      {loading && (
        <p role="status" aria-live="polite">
          Loading CLI device credentials…
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
          <p className="muted">No active CLI device credentials.</p>
          <p className="muted small">
            Run <code>mice login</code> to create a short-lived device credential. Personal
            access tokens are not available.
          </p>
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <ul className="ns-member-list" aria-labelledby={headingId}>
          {sessions.map((session) => {
            const shortId = session.id.slice(0, 12)
            const revokeLabel = `Revoke CLI credential ${shortId}`
            return (
              <li key={session.id} className="ns-member-row">
                <div className="ns-member-main">
                  <div>
                    <strong>Device credential</strong>
                    <span className="mono muted small" title={session.id}>
                      {' '}
                      {shortId}…
                    </span>
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
                  aria-label={revokeLabel}
                  onClick={() => void handleRevoke(session.id)}
                >
                  <Trash2 size={14} className="button-label-icon" aria-hidden="true" />
                  {revoking === session.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
