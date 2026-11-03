import { ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type DisabledSignerAlarm = {
  principalId: number
  sub: string
  iss: string
  name: string
  severity: 'critical'
  reason: string
}

export function DisabledSignersSection() {
  const [alarms, setAlarms] = useState<DisabledSignerAlarm[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch('/auth/admin/disabled-signers', {
          credentials: 'same-origin',
          signal: controller.signal,
        })
        const body = await res.json() as { alarms?: DisabledSignerAlarm[]; error?: string }
        if (!res.ok) throw new Error(body.error || 'Failed to load disabled signers')
        setAlarms(body.alarms ?? [])
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Failed to load disabled signers')
        setAlarms([])
      }
    })()
    return () => controller.abort()
  }, [])

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

      {alarms === null ? (
        <p className="muted">Loading…</p>
      ) : alarms.length === 0 ? (
        <p className="muted">No disabled Principal holds signing rights.</p>
      ) : (
        <ul className="ns-member-list">
          {alarms.map((alarm) => {
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

      {error && <p className="flash flash-error" role="alert">{error}</p>}
    </section>
  )
}
