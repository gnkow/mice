import { UserCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type ReenablePeriod = {
  principal: string
  disabledAt: string
  awaitingConfirmation: boolean
}

function splitPrincipal(principal: string): { iss: string; sub: string } {
  const bar = principal.indexOf('|')
  if (bar <= 0) return { iss: '', sub: principal }
  return { iss: principal.slice(0, bar), sub: principal.slice(bar + 1) }
}

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ReenableSection() {
  const [periods, setPeriods] = useState<ReenablePeriod[] | null>(null)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/auth/admin/re-enable', { credentials: 'same-origin' })
    const body = await res.json() as { periods?: ReenablePeriod[]; error?: string }
    if (!res.ok) throw new Error(body.error || 'Failed to load the re-enable queue')
    setPeriods(body.periods ?? [])
  }

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load the re-enable queue')
      setPeriods([])
    })
  }, [])

  async function confirm(principal: string) {
    const reason = (reasons[principal] ?? '').trim()
    if (reason.length < 10) {
      setError('Reason must be at least 10 characters')
      return
    }
    setBusy(principal)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/auth/admin/re-enable', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Mice-Reason': reason,
        },
        body: JSON.stringify({ principal }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) throw new Error(body.error || 'Confirmation failed')
      setNotice(`Restored ${splitPrincipal(principal).sub}`)
      setReasons((current) => ({ ...current, [principal]: '' }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id="re-enable" className="settings-section" aria-labelledby="re-enable-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="re-enable-heading">
            <UserCheck size={18} className="button-label-icon" aria-hidden="true" />
            Re-enable
          </h2>
          <p className="muted small">
            A Principal disabled in the identity provider for more than 30 days stays blocked after the account is enabled again. An instance admin confirms the restore. Grants stay in place.
          </p>
        </div>
      </div>

      {periods === null ? (
        <p className="muted">Loading…</p>
      ) : periods.length === 0 ? (
        <p className="muted">No Principals are in a disable period.</p>
      ) : (
        <ul className="ns-member-list">
          {periods.map((period) => {
            const { iss, sub } = splitPrincipal(period.principal)
            const nameHref = `/settings/principal?${new URLSearchParams({ iss, sub }).toString()}`
            return (
              <li key={period.principal} className="ns-member-row">
                <div className="ns-member-main">
                  <Link to={nameHref}>{sub}</Link>
                  <span className="muted small ns-member-sub">
                    Disabled {when(period.disabledAt)}
                    {period.awaitingConfirmation
                      ? ' · awaiting confirmation'
                      : ' · confirmation is not due'}
                  </span>
                </div>
                {period.awaitingConfirmation && (
                  <>
                    <label className="ns-settings-field">
                      <span className="visually-hidden">Reason for {sub}</span>
                      <input
                        value={reasons[period.principal] ?? ''}
                        onChange={(event) => setReasons((current) => ({
                          ...current,
                          [period.principal]: event.target.value,
                        }))}
                        placeholder="Why this Principal may sign in again"
                        disabled={busy !== null}
                      />
                    </label>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void confirm(period.principal)}
                    >
                      {busy === period.principal ? 'Confirming…' : 'Confirm'}
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="flash flash-error" role="alert">{error}</p>}
      {notice && <p className="flash flash-success" role="status">{notice}</p>}
    </section>
  )
}
