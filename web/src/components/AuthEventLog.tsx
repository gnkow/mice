import {
  AlertTriangle,
  Ban,
  FileText,
  LogIn,
  LogOut,
  RefreshCw,
  Shield,
  Smartphone,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'

/**
 * Feature 3: Authentication Event Log
 *
 * Displays user's authentication events (logins, logouts, failures, etc.)
 * Backend: GET /auth/me/events
 */

export type AuthEvent = {
  id: number
  action: string
  timestamp: number
  requestId: string
  message: string
  /** SHA-256(IP + day's salt) when the event had a client address; never the raw IP. */
  hashedIp?: string
}

type AuthEventsResponse = {
  events: AuthEvent[]
  limit: number
  offset: number
}

async function fetchAuthEvents(
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
): Promise<AuthEventsResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const res = await fetch(`/auth/me/events?${params}`, {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error('Failed to load auth events')
  return (await res.json()) as AuthEventsResponse
}

function formatEventTime(epochSec: number): string {
  const date = new Date(epochSec * 1000)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))

  if (days === 0) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } else if (days < 7) {
    return `${days}d ago`
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
}

function eventIcon(action: string): { Icon: LucideIcon; label: string } {
  if (action.includes('login')) return { Icon: LogIn, label: 'Sign-in' }
  if (action.includes('logout')) return { Icon: LogOut, label: 'Sign-out' }
  if (action.includes('refresh')) return { Icon: RefreshCw, label: 'Refresh' }
  if (action.includes('failure') || action.includes('fail')) {
    return { Icon: AlertTriangle, label: 'Failure' }
  }
  if (action.includes('device')) return { Icon: Smartphone, label: 'Device' }
  if (action.includes('revoke')) return { Icon: Ban, label: 'Revocation' }
  return { Icon: FileText, label: 'Event' }
}

export function AuthEventLog() {
  const headingId = useId()
  const descId = useId()
  const errorId = useId()
  const [data, setData] = useState<AuthEventsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadEvents(signal?: AbortSignal) {
    try {
      setLoading(true)
      setError(null)
      const result = await fetchAuthEvents(20, 0, signal)
      if (signal?.aborted) return
      setData(result)
    } catch (err) {
      if (signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Could not load auth events')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadEvents(ac.signal)
    return () => ac.abort()
  }, [])

  const events = data?.events ?? []

  return (
    <div
      className="ns-settings-subsection"
      data-testid="auth-event-log"
      aria-labelledby={headingId}
      aria-describedby={descId}
    >
      <div className="ns-settings-section-head">
        <h3 id={headingId}>
          <Shield size={16} className="button-label-icon" aria-hidden="true" />
          Security Activity
        </h3>
        <p id={descId} className="muted small">
          Recent authentication events on your account (last 20 events).
        </p>
      </div>

      {loading && (
        <p role="status" aria-live="polite">
          Loading security activity…
        </p>
      )}

      {!loading && error && (
        <div className="flash flash-error" role="alert" id={errorId} tabIndex={-1}>
          <p className="error">{error}</p>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void loadEvents()}
            aria-describedby={errorId}
          >
            <RefreshCw size={14} className="button-label-icon" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true" />
          <p className="muted">No recent authentication events.</p>
          <p className="muted small">
            Sign-ins, sign-outs, and failed attempts will appear here.
          </p>
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <ul className="ns-member-list" aria-labelledby={headingId}>
          {events.map((event) => {
            const { Icon, label } = eventIcon(event.action)
            const requestShort = event.requestId.slice(0, 8)
            const hashedIp = event.hashedIp?.trim()
            const hashedIpShort = hashedIp ? hashedIp.slice(0, 8) : null
            return (
              <li key={event.id} className="ns-member-row">
                <div className="ns-member-main">
                  <div>
                    <Icon
                      size={14}
                      className="button-label-icon"
                      aria-hidden="true"
                    />
                    <span className="visually-hidden">{label}: </span>
                    <span>{event.message}</span>
                  </div>
                  <span className="muted small">
                    <time dateTime={new Date(event.timestamp * 1000).toISOString()}>
                      {formatEventTime(event.timestamp)}
                    </time>
                    {' · '}
                    Request{' '}
                    <span className="mono" title={event.requestId}>
                      {requestShort}…
                    </span>
                    {hashedIp && hashedIpShort ? (
                      <>
                        {' · '}
                        Hashed IP{' '}
                        <code
                          className="mono auth-event-hashed-ip"
                          title={hashedIp}
                          data-testid="auth-event-hashed-ip"
                        >
                          {hashedIpShort}…
                        </code>
                      </>
                    ) : null}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
