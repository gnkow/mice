import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  confirmAccessRestore,
  fetchAccessState,
  liftAccessFlag,
  setAccessFlag,
} from '../lib/authzApi'

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

export function AdminAccessStateSection() {
  const [principal, setPrincipal] = useState('')
  const [loaded, setLoaded] = useState<string | null>(null)
  const [flagName, setFlagName] = useState('mice')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const state = useAsync(async (signal) => {
    if (!loaded) return null
    return fetchAccessState(loaded, signal)
  }, [loaded])

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      setMessage({ type: 'success', text: success })
      setReason('')
      state.reload()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Action failed' })
    } finally {
      setBusy(false)
    }
  }

  function onLoad(e: FormEvent) {
    e.preventDefault()
    if (principal.trim()) setLoaded(principal.trim())
  }

  function onFlag(e: FormEvent) {
    e.preventDefault()
    if (!loaded || !reason.trim()) return
    void run(() => setAccessFlag(loaded, flagName.trim() || 'mice', reason.trim()), 'Mice flag set. Access is suspended; grants are kept.')
  }

  function onLift(id: number) {
    if (!loaded || !reason.trim()) return
    void run(() => liftAccessFlag(loaded, id, reason.trim()), 'Mice flag lifted. Access is re-evaluated on the next request.')
  }

  function onRestore() {
    if (!loaded || !reason.trim()) return
    void run(() => confirmAccessRestore(loaded, reason.trim()), 'Access re-confirmed and audited.')
  }

  return (
    <section id="access-state" className="settings-section" aria-labelledby="access-state-heading">
      <div className="ns-settings-section-head">
        <div>
          <h2 id="access-state-heading">
            <ShieldAlert size={18} className="button-label-icon" aria-hidden="true" />
            Access state
          </h2>
          <p className="muted small">
            IdP disable state and Mice flags are independent. Flags suspend access without deleting grants.
            Re-enabling within 30 days restores automatically unless a flag is active; older disables need re-confirmation.
          </p>
        </div>
      </div>

      {message && (
        <div className={`flash ${message.type === 'error' ? 'flash-error' : 'flash-success'}`} role="alert">
          {message.text}
        </div>
      )}

      <form className="ns-member-form" onSubmit={onLoad}>
        <div className="ns-settings-grid">
          <label className="ns-settings-field">
            <span className="ns-settings-label">Principal (iss|sub)</span>
            <input
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              placeholder="https://idp.example.com|user123"
              required
            />
          </label>
        </div>
        <div className="ns-member-form-actions">
          <button className="btn primary" type="submit" disabled={!principal.trim()}>
            Load access state
          </button>
        </div>
      </form>

      {state.kind === 'loading' && <p role="status">Loading access state...</p>}
      {state.kind === 'error' && <div className="flash flash-error" role="alert">{state.message}</div>}
      {state.kind === 'ok' && state.data && (
        <div className="ns-settings-subsection">
          <h3>Current state</h3>
          <dl className="muted small">
            <dt>Principal</dt><dd><code>{state.data.principal}</code></dd>
            <dt>IdP disabled at</dt><dd>{fmt(state.data.idpDisabledAt)}</dd>
            <dt>Automatic restore deadline</dt><dd>{fmt(state.data.restoreDeadline)}</dd>
            <dt>Restore gate</dt>
            <dd>
              {state.data.flags.length > 0
                ? 'Mice flag active — lift it explicitly'
                : state.data.restoreRequiresApproval
                  ? 'Admin re-confirmation required'
                  : state.data.canAutoRestore
                    ? 'Eligible for automatic restore'
                    : 'Nothing suspended'}
            </dd>
          </dl>

          <label className="ns-settings-field">
            <span className="ns-settings-label">Reason for the next action</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this flag, lift, or re-confirmation is appropriate"
              required
            />
          </label>

          {state.data.flags.length > 0 && (
            <ul className="ns-member-list">
              {state.data.flags.map((flag) => (
                <li key={flag.id} className="ns-member-row">
                  <div className="ns-member-main">
                    <div>
                      <strong>{flag.flag}</strong>
                      <span className="muted small"> · {flag.reason}</span>
                    </div>
                    <span className="muted small">
                      Set by {flag.createdBy}
                      <br />
                      {fmt(flag.createdAt)}
                    </span>
                  </div>
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={busy || !reason.trim()}
                    onClick={() => onLift(flag.id)}
                  >
                    <ShieldCheck size={14} aria-hidden="true" className="button-label-icon" />
                    Lift flag
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="ns-member-form" onSubmit={onFlag}>
            <div className="ns-settings-grid">
              <label className="ns-settings-field">
                <span className="ns-settings-label">Flag</span>
                <input value={flagName} onChange={(e) => setFlagName(e.target.value)} placeholder="mice" />
              </label>
            </div>
            <div className="ns-member-form-actions">
              <button className="btn danger" type="submit" disabled={busy || !reason.trim()}>
                Set Mice flag
              </button>
            </div>
          </form>

          {(state.data.restoreRequiresApproval || state.data.canAutoRestore) && (
            <div className="ns-member-form-actions">
              <button
                className="btn primary"
                type="button"
                disabled={busy || !reason.trim() || state.data.flags.length > 0}
                onClick={onRestore}
              >
                Re-confirm restore
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
