import { ShieldAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  checkGroupBindingMode,
  fetchGroupBindingStatus,
  type GroupBindingStatus,
} from '../lib/authzApi'

export function GroupBindingSection() {
  const state = useAsync((signal) => fetchGroupBindingStatus(signal), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<GroupBindingStatus | null>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const errorId = useId()

  const status = result ?? (state.kind === 'ok' ? state.data : null)

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  async function onCheck() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = await checkGroupBindingMode()
      setResult(next)
      setNotice(
        next.warning
          ? 'Binding check finished with a warning.'
          : 'Binding check confirmed object-id group grants.',
      )
      state.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="group-binding" className="settings-section" aria-labelledby="group-binding-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="group-binding-heading">
            <ShieldAlert size={18} className="button-label-icon" aria-hidden="true" />
            Group binding validation
          </h2>
          <p className="muted small">
            Confirm the IdP supplies immutable group object ids. Name-based bindings
            break silently when a group is renamed in the directory.
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
      {notice && !error && (
        <p className="flash flash-success" role="status">{notice}</p>
      )}

      {state.kind === 'loading' && !status && (
        <p className="muted small" aria-live="polite">Loading…</p>
      )}
      {state.kind === 'error' && !status && (
        <p className="flash flash-error" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === 'ok' && !status?.checkedAt && !result && (
        <p className="muted small" role="status">
          No binding check yet. Run Check to confirm the IdP returns group object ids for grants.
        </p>
      )}

      {status && (
        <p
          className={status.warning ? 'flash flash-warn' : 'flash flash-success'}
          role="status"
        >
          {status.message}
          {status.checkedAt && (
            <span className="muted small">
              {' '}
              · checked {new Date(status.checkedAt).toLocaleString()}
            </span>
          )}
        </p>
      )}

      <div className="btn-row ns-settings-actions">
        <button
          className="btn primary"
          type="button"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void onCheck()}
        >
          {busy ? 'Checking…' : 'Check'}
        </button>
      </div>
    </section>
  )
}
