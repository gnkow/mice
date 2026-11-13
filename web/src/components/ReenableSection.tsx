import { UserCheck } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
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
  const [fieldErrorFor, setFieldErrorFor] = useState<string | null>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const errorId = useId()

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

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  async function confirm(principal: string) {
    const reason = (reasons[principal] ?? '').trim()
    if (reason.length < 10) {
      setFieldErrorFor(principal)
      setError('Reason must be at least 10 characters')
      return
    }
    setBusy(principal)
    setError(null)
    setFieldErrorFor(null)
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

  const awaiting = periods?.filter((p) => p.awaitingConfirmation) ?? []

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
        {periods !== null && (
          <p className="muted small ns-settings-count">
            {awaiting.length === 0
              ? 'None awaiting'
              : `${awaiting.length} awaiting`}
          </p>
        )}
      </div>

      {error && (
        <p
          id={errorId}
          ref={errorRef}
          className="flash flash-error"
          role="alert"
          tabIndex={-1}
        >
          {error}
        </p>
      )}
      {notice && <p className="flash flash-success" role="status">{notice}</p>}

      {periods === null ? (
        <p className="muted" aria-live="polite">Loading…</p>
      ) : periods.length === 0 ? (
        <p className="muted small" role="status">
          No Principals are in a disable period. When someone returns from a long IdP disable, they appear here for confirmation.
        </p>
      ) : (
        <ul className="ns-member-list">
          {periods.map((period) => {
            const { iss, sub } = splitPrincipal(period.principal)
            const nameHref = `/settings/principal?${new URLSearchParams({ iss, sub }).toString()}`
            const reasonInvalid = fieldErrorFor === period.principal
            const reasonFieldId = `reenable-reason-${period.principal}`
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
                    <label className="ns-settings-field" htmlFor={reasonFieldId}>
                      <span className="ns-settings-label">Reason</span>
                      <input
                        id={reasonFieldId}
                        value={reasons[period.principal] ?? ''}
                        onChange={(event) => {
                          setReasons((current) => ({
                            ...current,
                            [period.principal]: event.target.value,
                          }))
                          if (fieldErrorFor === period.principal) setFieldErrorFor(null)
                        }}
                        placeholder="Why this Principal may sign in again"
                        disabled={busy !== null}
                        aria-invalid={reasonInvalid || undefined}
                        aria-describedby={reasonInvalid ? errorId : undefined}
                      />
                    </label>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={busy !== null}
                      aria-busy={busy === period.principal || undefined}
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
    </section>
  )
}
