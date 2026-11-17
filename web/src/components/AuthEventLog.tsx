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
import { Pagination } from './Pagination'

/**
 * Feature 3: Authentication Event Log
 *
 * Displays user's authentication events (logins, logouts, failures, etc.)
 * Backend: GET /auth/me/events
 */

/** Page size for Security Activity (Profile Access). */
export const AUTH_EVENT_PAGE_SIZE = 5

export type AuthEvent = {
  id: number
  action: string
  /** success | failure from the auth-event store (when the API includes it). */
  outcome?: 'success' | 'failure'
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
  limit: number,
  offset: number,
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

function eventIcon(action: string, outcome?: string): { Icon: LucideIcon; label: string } {
  if (outcome === 'failure' || action.includes('failure') || action.includes('fail')) {
    return { Icon: AlertTriangle, label: 'Failure' }
  }
  if (action.includes('login')) return { Icon: LogIn, label: 'Sign-in' }
  if (action.includes('logout')) return { Icon: LogOut, label: 'Sign-out' }
  if (action.includes('refresh')) return { Icon: RefreshCw, label: 'Refresh' }
  if (action.includes('device')) return { Icon: Smartphone, label: 'Device' }
  if (action.includes('revoke') || action.includes('revocation')) {
    return { Icon: Ban, label: 'Revocation' }
  }
  return { Icon: FileText, label: 'Event' }
}

function eventTitle(action: string, outcome?: string, message?: string): string {
  const kind = action.trim() || 'event'
  const titled = kind.charAt(0).toUpperCase() + kind.slice(1)
  if (outcome === 'failure') return `${titled} failed`
  if (outcome === 'success') return `${titled} success`
  return message?.trim() || titled
}

export function AuthEventLog() {
  const headingId = useId()
  const descId = useId()
  const errorId = useId()
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AuthEventsResponse | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadEvents(pageNum: number, signal?: AbortSignal) {
    try {
      setLoading(true)
      setError(null)
      const offset = (pageNum - 1) * AUTH_EVENT_PAGE_SIZE
      const result = await fetchAuthEvents(AUTH_EVENT_PAGE_SIZE, offset, signal)
      if (signal?.aborted) return
      setData(result)
      setHasMore(result.events.length === AUTH_EVENT_PAGE_SIZE)
      setPage(pageNum)
    } catch (err) {
      if (signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Could not load auth events')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadEvents(1, ac.signal)
    return () => ac.abort()
  }, [])

  const events = data?.events ?? []
  const pageCount = Math.max(1, hasMore ? page + 1 : page)
  const showPager = !loading && !error && (page > 1 || hasMore || events.length > 0)

  return (
    <div
      id="profile-security-activity"
      className="ns-settings-subsection"
      data-testid="auth-event-log"
      aria-labelledby={headingId}
      aria-describedby={descId}
    >
      <div className="ns-settings-section-head">
        <div>
          <h3 id={headingId}>
            <Shield size={16} className="button-label-icon" aria-hidden="true" />
            Security Activity
          </h3>
          <p id={descId} className="muted small">
            Recent authentication events on your account ({AUTH_EVENT_PAGE_SIZE} per page).
          </p>
        </div>
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
            onClick={() => void loadEvents(page)}
            aria-describedby={errorId}
          >
            <RefreshCw size={14} className="button-label-icon" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {!loading && !error && events.length === 0 && page === 1 && (
        <div className="empty-state" role="status">
          <Shield size={28} className="empty-state-icon-lucide" aria-hidden="true" />
          <p className="muted">No recent authentication events.</p>
          <p className="muted small">
            Sign-ins, sign-outs, and failed attempts will appear here.
          </p>
        </div>
      )}

      {!loading && !error && events.length === 0 && page > 1 && (
        <p className="muted small" role="status">
          No more authentication events on this page.
        </p>
      )}

      {!loading && !error && events.length > 0 && (
        <ul className="ns-member-list" aria-labelledby={headingId} data-testid="auth-event-list">
          {events.map((event) => {
            const { Icon, label } = eventIcon(event.action, event.outcome)
            const title = eventTitle(event.action, event.outcome, event.message)
            const requestShort = event.requestId.slice(0, 8)
            const hashedIp = event.hashedIp?.trim()
            const hashedIpShort = hashedIp ? hashedIp.slice(0, 8) : null
            const failed = event.outcome === 'failure'
            return (
              <li key={event.id} className="ns-member-row auth-event-row">
                <div className="ns-member-main">
                  <div className="auth-event-title-row">
                    <Icon
                      size={14}
                      className={`button-label-icon${failed ? ' auth-event-icon-fail' : ''}`}
                      aria-hidden="true"
                    />
                    <span className="visually-hidden">{label}: </span>
                    <span>{title}</span>
                    {event.outcome ? (
                      <span
                        className={`pill auth-event-outcome${failed ? ' is-failure' : ' is-success'}`}
                        data-testid="auth-event-outcome"
                      >
                        {failed ? 'Failed' : 'OK'}
                      </span>
                    ) : null}
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

      {showPager ? (
        <div className="auth-event-footer">
          <Pagination
            page={page}
            pageCount={pageCount}
            onPageChange={(next) => void loadEvents(next)}
            label="Security activity pages"
          />
          <button
            type="button"
            className="btn ghost"
            onClick={() => void loadEvents(page)}
            aria-label="Refresh security activity"
          >
            <RefreshCw size={14} className="button-label-icon" aria-hidden="true" />
            Refresh
          </button>
        </div>
      ) : null}
    </div>
  )
}
