import { Ban } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { DirectoryPicker } from './DirectoryPicker'
import {
  fetchMiceSuspension,
  liftMiceSuspension,
  setMiceSuspension,
  type SuspensionHistoryEntry,
} from '../lib/authzApi'

/** Mice suspension is independent of IdP status. Grants stay; login and sessions stop. */
export function MiceSuspensionSection({ signedInIss }: { signedInIss: string }) {
  const [sub, setSub] = useState('')
  const [iss, setIss] = useState(signedInIss)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [history, setHistory] = useState<SuspensionHistoryEntry[] | null>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const errorId = useId()
  const reasonId = useId()

  const principal = sub.trim() && iss.trim() ? `${iss.trim()}|${sub.trim()}` : ''
  const suspended = history?.at(-1)?.action === 'set'

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  async function loadHistory(target = principal) {
    if (!target) {
      setError('Choose a user before loading history')
      return
    }
    const body = await fetchMiceSuspension(target)
    setHistory(body.history)
  }

  async function run(action: 'set' | 'lift', e: { preventDefault(): void }) {
    e.preventDefault()
    if (!principal) {
      setError('Choose a user')
      return
    }
    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (action === 'set') await setMiceSuspension(principal, reason.trim())
      else await liftMiceSuspension(principal, reason.trim())
      await loadHistory()
      setNotice(action === 'set' ? `Suspended ${sub.trim()}` : `Lifted suspension of ${sub.trim()}`)
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="mice-suspension" className="settings-section" aria-labelledby="mice-suspension-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="mice-suspension-heading">
            <Ban size={18} className="button-label-icon" aria-hidden="true" />
            Mice suspension
          </h2>
          <p className="muted small">
            Suspends a Principal inside Mice even when the identity provider still lists them as enabled.
            Existing sessions end. Grants stay in place.
          </p>
        </div>
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

      <form className="ns-member-form" onSubmit={(e) => void run('set', e)}>
        <div className="ns-member-form-fields">
          <DirectoryPicker
            kind="user"
            sub={sub}
            iss={iss || signedInIss}
            defaultIss={signedInIss}
            disabled={busy}
            onChange={(next) => {
              setSub(next.sub)
              setIss(next.iss)
              setHistory(null)
              setError(null)
              setNotice(null)
            }}
          />
        </div>
        <label className="ns-settings-field" htmlFor={reasonId}>
          <span className="ns-settings-label">Reason</span>
          <input
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this suspension is changing"
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        <div className="btn-row ns-settings-actions">
          <button
            className="btn danger"
            type="submit"
            disabled={busy || !principal}
            aria-busy={busy || undefined}
          >
            {busy ? 'Working…' : 'Suspend'}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy || !principal}
            onClick={(e) => void run('lift', e)}
          >
            Lift suspension
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy || !principal}
            onClick={() => {
              setError(null)
              void loadHistory().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Could not load history')
              })
            }}
          >
            Show history
          </button>
        </div>
      </form>

      {!principal && history === null && (
        <p className="muted small" role="status">
          Choose a user to suspend, lift, or review Mice suspension history.
        </p>
      )}

      {history && (
        <>
          <p className="muted small" role="status">
            {history.length === 0
              ? 'No Mice suspension history for this Principal.'
              : suspended
                ? 'Currently suspended.'
                : 'Not suspended.'}
          </p>
          {history.length > 0 && (
            <ul className="ns-member-list">
              {history.map((row) => (
                <li key={`${row.at}\0${row.action}`} className="ns-member-row">
                  <div className="ns-member-main">
                    <code className="ns-member-sub">{row.action}</code>
                    <span className="muted small">
                      {row.reason}
                      {' · '}
                      {row.actor}
                      {' · '}
                      {row.at}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
