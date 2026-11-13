import { ShieldAlert } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { SigningChallenge } from '../lib/signingChallenge'

type Props = {
  challenge: SigningChallenge
  /** When set, shows Cancel and dismisses without navigating. */
  onDismiss?: () => void
  onContinue: () => void
}

/**
 * Titled interstitial before step-up / idle / MFA redirect.
 * Announces the problem (role=alert) and offers a clear Continue CTA.
 */
export function SigningChallengeInterstitial({
  challenge,
  onDismiss,
  onContinue,
}: Props) {
  const titleId = useId()
  const messageId = useId()
  const continueRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => continueRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [challenge.kind])

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      data-testid="signing-challenge-interstitial"
      data-challenge-kind={challenge.kind}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onDismiss) onDismiss()
      }}
    >
      <div
        className="modal reason-prompt signing-challenge"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId} className="modal-title">
          <ShieldAlert size={18} aria-hidden="true" className="button-label-icon" />
          {challenge.title}
        </h2>
        <p id={messageId} className="flash flash-error" role="alert" tabIndex={-1}>
          {challenge.message}
        </p>
        <div className="btn-row modal-actions">
          {onDismiss ? (
            <button type="button" className="btn ghost" onClick={onDismiss}>
              Cancel
            </button>
          ) : null}
          <button
            ref={continueRef}
            type="button"
            className="btn primary"
            data-testid="signing-challenge-continue"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
