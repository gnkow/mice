import { KeyRound, ShieldAlert, TimerReset } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import type { SigningChallenge, SigningChallengeKind } from '../lib/signingChallenge'

type Props = {
  challenge: SigningChallenge
  /** When set, shows Cancel and dismisses without navigating. */
  onDismiss?: () => void
  onContinue: () => void
}

const KIND_META: Record<
  SigningChallengeKind,
  {
    Icon: typeof ShieldAlert
    tone: 'warn' | 'error'
    continueLabel: string
    hint: string
  }
> = {
  step_up: {
    Icon: ShieldAlert,
    tone: 'warn',
    continueLabel: "Confirm it's you",
    hint: 'You will sign in again as the same account. When you return, the signature ceremony continues automatically — you do not start the action over.',
  },
  session_idle: {
    Icon: TimerReset,
    tone: 'warn',
    continueLabel: 'Sign in again',
    hint: 'Your session timed out from inactivity. Sign in again; when you return, the signature ceremony continues automatically.',
  },
  mfa_required: {
    Icon: KeyRound,
    tone: 'error',
    continueLabel: 'Complete MFA',
    hint: 'After MFA you return here and the signature ceremony continues automatically — you do not click Approve / Grant again.',
  },
}

/**
 * Titled interstitial before step-up / idle / MFA redirect.
 * Announces the problem (role=alert) and offers a kind-specific Continue CTA.
 */
export function SigningChallengeInterstitial({
  challenge,
  onDismiss,
  onContinue,
}: Props) {
  const titleId = useId()
  const messageId = useId()
  const hintId = useId()
  const continueRef = useRef<HTMLButtonElement>(null)
  const meta = KIND_META[challenge.kind]
  const { Icon } = meta

  useEffect(() => {
    const t = window.setTimeout(() => continueRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [challenge.kind])

  useEffect(() => {
    if (!onDismiss) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

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
        className={`modal reason-prompt signing-challenge signing-challenge-${challenge.kind}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${messageId} ${hintId}`}
      >
        <h2 id={titleId} className="modal-title">
          <Icon size={18} aria-hidden="true" className="button-label-icon" />
          {challenge.title}
        </h2>
        <p
          id={messageId}
          className={`flash ${meta.tone === 'error' ? 'flash-error' : 'flash-warn'}`}
          role="alert"
          tabIndex={-1}
        >
          {challenge.message}
        </p>
        <p id={hintId} className="signing-challenge-hint muted small">
          {meta.hint}
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
            {meta.continueLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
