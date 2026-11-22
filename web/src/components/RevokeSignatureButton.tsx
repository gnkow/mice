import { ShieldOff as ActionShieldOff } from 'lucide-react'
import { useId, useState } from 'react'
import { revokeSignature } from '../lib/authzApi'
import { revokeFailureMessage } from '../lib/signatureRevoke'

type Props = {
  signatureId: string
  /** Called after the revoke succeeded so the caller can refresh its list. */
  onRevoked?: () => void
}

/**
 * Revokes a signature (GxP #93). The reason + signing ceremony opens through `authzFetch`
 * → `withReason`; failures such as `not_approver` render inline with `role="alert"`.
 */
export function RevokeSignatureButton({ signatureId, onRevoked }: Props) {
  const errorId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ blocked: number } | null>(null)

  async function onClick() {
    setBusy(true)
    setError(null)
    try {
      const res = await revokeSignature(signatureId)
      setDone({ blocked: res.blockedMergeRequestIds.length })
      onRevoked?.()
    } catch (err) {
      setError(revokeFailureMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="flash flash-success small" role="status" data-testid="signature-revoked">
        Signature revoked. Affected commits are now QC Failed
        {done.blocked > 0
          ? `; ${done.blocked} open merge request${done.blocked === 1 ? '' : 's'} blocked`
          : ''}
        .
      </p>
    )
  }

  return (
    <div className="signature-revoke">
      <button
        type="button"
        className="btn danger small"
        disabled={busy}
        aria-label={busy ? 'Revoking signature' : 'Revoke signature'}
        aria-describedby={error ? errorId : undefined}
        onClick={() => void onClick()}
      >
        <ActionShieldOff size={12} aria-hidden="true" className="button-label-icon" />
        {busy ? 'Revoking…' : 'Revoke'}
      </button>
      {error ? (
        <p id={errorId} className="flash flash-error small" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
