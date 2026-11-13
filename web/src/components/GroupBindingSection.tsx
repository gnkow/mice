import { Link2, ShieldAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useAsync } from '../hooks/useAsync'
import {
  checkGroupBindingMode,
  fetchGroupBindingStatus,
  type GroupBindingStatus,
} from '../lib/authzApi'

function ModeBadge({ mode, warning }: { mode: GroupBindingStatus['mode']; warning: boolean }) {
  return (
    <span
      className={
        warning
          ? 'group-binding-chip group-binding-chip-warn'
          : 'group-binding-chip group-binding-chip-ok'
      }
      data-testid="group-binding-mode"
      data-mode={mode}
    >
      {mode === 'id-based' ? 'ID-based (recommended)' : 'Name-based fallback'}
    </span>
  )
}

export function GroupBindingSection() {
  const state = useAsync((signal) => fetchGroupBindingStatus(signal), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<GroupBindingStatus | null>(null)
  const [sampleText, setSampleText] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  const errorId = useId()
  const sampleId = useId()
  const statusId = useId()

  const status = result ?? (state.kind === 'ok' ? state.data : null)
  const hasCheck = Boolean(status?.checkedAt)

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  async function onCheck() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const samples = sampleText
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const next = await checkGroupBindingMode(samples.length ? samples : undefined)
      setResult(next)
      setNotice(
        next.warning
          ? 'Binding check finished with a name-based warning.'
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
    <section
      id="group-binding"
      className="settings-section"
      aria-labelledby="group-binding-heading"
      aria-busy={busy || undefined}
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="group-binding-heading">
            <ShieldAlert size={18} className="button-label-icon" aria-hidden="true" />
            Group binding validation
          </h2>
          <p className="muted small">
            Confirm the IdP supplies immutable group object ids. Name-based bindings
            break silently when a group is renamed in the directory. Namespace owners
            also see a warning on any name-based grant.
          </p>
        </div>
        {hasCheck && status ? <ModeBadge mode={status.mode} warning={status.warning} /> : null}
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
        <p className="flash flash-success" role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {state.kind === 'loading' && !status && (
        <p className="muted small" aria-live="polite">
          Loading…
        </p>
      )}
      {state.kind === 'error' && !status && (
        <p className="flash flash-error" role="alert">
          {state.message}
        </p>
      )}

      {!hasCheck && state.kind === 'ok' && !result && (
        <div className="group-binding-empty" role="status">
          <p className="muted small">
            No binding check yet. Run Check to confirm the IdP returns group object ids
            for grants.
          </p>
        </div>
      )}

      {hasCheck && status && (
        <div
          id={statusId}
          className={
            status.warning
              ? 'group-binding-status flash flash-warn'
              : 'group-binding-status flash flash-success'
          }
          role="status"
          aria-live="polite"
          data-testid="group-binding-status"
        >
          <div className="group-binding-status-row">
            <ModeBadge mode={status.mode} warning={status.warning} />
            {status.checkedAt ? (
              <span className="muted small">
                Checked {new Date(status.checkedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          <p className="group-binding-status-message">{status.message}</p>
          {status.warning ? (
            <p className="muted small group-binding-status-hint">
              Namespace owners see this same warning on memberships that still bind by
              display name.
            </p>
          ) : null}
        </div>
      )}

      <div className="group-binding-form">
        <label htmlFor={sampleId}>
          Optional sample group ids
          <textarea
            id={sampleId}
            className="group-binding-samples"
            rows={2}
            value={sampleText}
            disabled={busy}
            placeholder="Paste UUID object ids (comma or newline separated). Leave empty to use the server’s IdP sample."
            onChange={(e) => setSampleText(e.target.value)}
          />
        </label>
        <p className="muted small">
          Prefer object ids from your IdP claims. Name-shaped samples force the
          name-based warning so you can rehearse the fallback.
        </p>
        <div className="btn-row ns-settings-actions">
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            aria-describedby={hasCheck ? statusId : undefined}
            onClick={() => void onCheck()}
          >
            <Link2 size={14} aria-hidden="true" className="button-label-icon" />
            {busy ? 'Checking…' : 'Check'}
          </button>
        </div>
      </div>
    </section>
  )
}
