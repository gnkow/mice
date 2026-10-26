import { Shield } from 'lucide-react'
import { useEffect, useState } from 'react'

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
}

type AuthEventsResponse = {
  events: AuthEvent[]
  limit: number
  offset: number
}

async function fetchAuthEvents(limit = 20, offset = 0, signal?: AbortSignal): Promise<AuthEventsResponse> {
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

function getEventIcon(action: string): string {
  if (action.includes('login')) return '🔓'
  if (action.includes('logout')) return '🚪'
  if (action.includes('refresh')) return '🔄'
  if (action.includes('failure') || action.includes('fail')) return '❌'
  if (action.includes('device')) return '📱'
  if (action.includes('revoke')) return '⛔'
  return '📝'
}

export function AuthEventLog() {
  const [data, setData] = useState<AuthEventsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadEvents() {
    try {
      setError(null)
      const result = await fetchAuthEvents(20)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load auth events')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadEvents()
  }, [])

  if (loading) {
    return <p role="status">Loading security activity...</p>
  }

  if (error) {
    return (
      <div className="flash flash-error" role="alert">
        {error}
      </div>
    )
  }

  const events = data?.events || []

  return (
    <section id="security-activity" className="settings-section" aria-labelledby="security-activity-heading">
      <div className="ns-settings-section-head">
        <h3 id="security-activity-heading">
          <Shield size={16} className="button-label-icon" aria-hidden="true" />
          Security Activity
        </h3>
        <p className="muted small">
          Recent authentication events on your account (last 20 events).
        </p>
      </div>

      {events.length === 0 && (
        <p className="muted small">No recent authentication events.</p>
      )}

      {events.length > 0 && (
        <ul className="ns-member-list">
          {events.map(event => (
            <li key={event.id} className="ns-member-row">
              <div className="ns-member-main">
                <div>
                  <span>{getEventIcon(event.action)} {event.message}</span>
                </div>
                <span className="muted small">
                  {formatEventTime(event.timestamp)} · Request: {event.requestId.slice(0, 8)}...
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
