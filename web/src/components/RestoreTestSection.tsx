import { DatabaseBackup } from 'lucide-react'
import { useState } from 'react'
import { useAsync } from '../hooks/useAsync'
import { fetchRestoreTest, recordRestoreTestPass } from '../lib/authzApi'

/**
 * GxP #101 — operator UI for the restore-test gate before first regulated action.
 */
export function RestoreTestSection() {
  const state = useAsync((signal) => fetchRestoreTest(signal), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function onPass() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await recordRestoreTestPass()
      setNotice('Restore test recorded as passed.')
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record restore test')
    } finally {
      setBusy(false)
    }
  }

  const status = state.kind === 'ok' ? state.data.restoreTest : null

  return (
    <section
      id="restore-test"
      className="settings-section"
      aria-labelledby="restore-test-heading"
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id="restore-test-heading">
            <DatabaseBackup
              size={18}
              className="button-label-icon"
              aria-hidden="true"
            />
            Restore test
          </h2>
          <p className="muted small">
            A successful restore test is required before the first regulated merge or
            signature. Record a pass after you have verified backup restore.
          </p>
        </div>
      </div>

      {state.kind === 'loading' ? <p className="muted">Loading…</p> : null}
      {state.kind === 'error' ? (
        <p className="flash flash-error" role="alert">
          {state.message}
        </p>
      ) : null}

      {status ? (
        <div className="ns-settings-grid">
          <div className="ns-settings-field">
            <span className="ns-settings-label">Gate</span>
            <p className={status.passed ? 'flash flash-success' : 'flash flash-warning'}>
              {status.passed ? 'Passed' : 'Not passed yet'}
            </p>
          </div>
          {status.passedAt ? (
            <div className="ns-settings-field">
              <span className="ns-settings-label">Passed at</span>
              <p className="muted small">
                {new Date(status.passedAt).toLocaleString()}
                {status.recordedBy ? ` · ${status.recordedBy}` : ''}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="flash flash-success" role="status">
          {notice}
        </p>
      ) : null}

      <div className="btn-row" style={{ marginTop: '1rem' }}>
        <button
          type="button"
          className="btn primary"
          disabled={busy || status?.passed === true}
          onClick={() => void onPass()}
        >
          {busy ? 'Recording…' : 'Record restore test pass'}
        </button>
      </div>
    </section>
  )
}
