import { RotateCcw } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { revertSignatureRevocation } from '../lib/authzApi'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import { Modal } from './Modal'

type Props = {
  signatureId: string
  revocationId: string
  /** Called after a successful revert so the list can refresh. */
  onReverted?: () => void
}

function shortSha(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

/**
 * Approver revert of a prior signature revocation (GxP #159 / story 10a).
 * Confirm opens the electronic signature ceremony via `authzFetch` → `withReason`.
 */
export function RevertRevocationButton({ signatureId, revocationId, onReverted }: Props) {
  const errorId = useId()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const submitting = useRef(false)

  async function confirm() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await revertSignatureRevocation(signatureId, revocationId)
      setDone(true)
      setOpen(false)
      onReverted?.()
    } catch (err) {
      if (isCeremonyCancelled(err)) {
        setOpen(false)
        return
      }
      setError(err instanceof Error ? err.message : 'Revert failed')
    } finally {
      setBusy(false)
      submitting.current = false
    }
  }

  if (done) {
    return (
      <p className="flash flash-success small" role="status" data-testid="signature-revocation-reverted">
        Revocation reverted — covered commits return to QC Passed.
      </p>
    )
  }

  return (
    <div className="signature-revert" data-testid="signature-revert">
      <button
        type="button"
        className="btn ghost small"
        aria-label="Revert revocation"
        data-testid="signature-revert-button"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <RotateCcw size={12} aria-hidden="true" className="button-label-icon" />
        Revert
      </button>

      {open ? (
        <Modal title="Revert revocation" onClose={() => { if (!busy) setOpen(false) }}>
          <div className="signature-revert-modal" data-testid="signature-revert-modal">
            <p>
              Restore QC Passed for commits failed by this revocation on signature{' '}
              <span className="mono">{shortSha(signatureId)}</span>. The original signature and
              revoke records stay visible (append-only).
            </p>
            <p className="muted small">
              Confirm opens the electronic signature ceremony. Owners and the original signer are
              notified.
            </p>
            {error ? (
              <div className="flash flash-error" role="alert" id={errorId}>
                <p>{error}</p>
              </div>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                data-testid="signature-revert-confirm"
                aria-describedby={error ? errorId : undefined}
                onClick={() => void confirm()}
              >
                {busy ? 'Reverting…' : 'Confirm revert'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
