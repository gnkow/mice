import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
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
  const [result, setResult] = useState<GroupBindingStatus | null>(null)

  const status = result ?? (state.kind === 'ok' ? state.data : null)

  async function onCheck() {
    setBusy(true)
    setError(null)
    try {
      const next = await checkGroupBindingMode()
      setResult(next)
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

      {state.kind === 'loading' && !status && <p className="muted small">Loading…</p>}
      {state.kind === 'error' && !status && (
        <p className="flash flash-error" role="alert">
          {state.message}
        </p>
      )}

      {status && (
        <p
          className={status.warning ? 'flash flash-error' : 'flash flash-success'}
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

      {error && (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      )}

      <div className="btn-row ns-settings-actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void onCheck()}>
          Check
        </button>
      </div>
    </section>
  )
}
