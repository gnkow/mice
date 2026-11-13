import { RefreshCw, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type DisabledSignerAlarm = {
  principalId: number
  sub: string
  iss: string
  name: string
  severity: 'critical'
  reason: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; alarms: DisabledSignerAlarm[] }

export function DisabledSignersSection() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/auth/admin/disabled-signers', {
        credentials: 'same-origin',
        signal,
      })
      const body = await res.json() as { alarms?: DisabledSignerAlarm[]; error?: string }
      if (!res.ok) throw new Error(body.error || 'Failed to load disabled signers')
      setState({ kind: 'ok', alarms: body.alarms ?? [] })
    } catch (err) {
      if (signal?.aborted) return
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to load disabled signers',
      })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <section id="disabled-signers" className="settings-section" aria-labelledby="disabled-signers-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="disabled-signers-heading">
            <ShieldAlert size={18} className="button-label-icon" aria-hidden="true" />
            Disabled signers
          </h2>
          <p className="muted small">
            Principals the identity provider lists as disabled who still hold signing rights in Mice. The daily drift job raises the same alarm.
          </p>
        </div>
      </div>

      {state.kind === 'loading' && (
        <p role="status" aria-live="polite">Loading disabled signers…</p>
      )}

      {state.kind === 'error' && (
        <div className="flash flash-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn ghost" onClick={() => void load()}>
            <RefreshCw size={14} className="button-label-icon" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {state.kind === 'ok' && state.alarms.length === 0 && (
        <div className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true" />
          <p className="muted">No disabled Principal holds signing rights.</p>
          <p className="muted small">
            Critical alarms appear here when the directory disables a Principal who can still sign.
          </p>
        </div>
      )}

      {state.kind === 'ok' && state.alarms.length > 0 && (
        <ul className="ns-member-list">
          {state.alarms.map((alarm) => {
            const href = `/settings/principal?${new URLSearchParams({ iss: alarm.iss, sub: alarm.sub }).toString()}`
            return (
              <li key={alarm.principalId} className="ns-member-row">
                <div className="ns-member-main">
                  <Link to={href}>{alarm.name}</Link>
                  <span className="muted small ns-member-sub">{alarm.reason}</span>
                </div>
                <span className="flash flash-error">Critical</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
