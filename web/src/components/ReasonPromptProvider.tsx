import { Check as ActionCheck, X as ActionX } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import {
  REASON_CATEGORIES,
  registerReasonOpener,
  type ReasonCategoryValue,
  type ReasonPromptOptions,
  type ReasonSubmission,
} from '../lib/reasonPrompt'
import {
  classifySigningChallenge,
  type SigningChallenge,
} from '../lib/signingChallenge'
import { SigningChallengeInterstitial } from './SigningChallengeInterstitial'

type Pending = {
  options: ReasonPromptOptions
  resolve: (value: ReasonSubmission | null) => void
}

type Prepared = {
  content: string
  hash: string
  action: string
  meaning: 'Approved'
  principal: { iss: string; sub: string; name: string }
}

const PLACEHOLDER =
  'e.g. Corrected assay plate layout after deviation DEV-12'

const GXP_NOTICE =
  'Under GxP, who made this change and why is permanently recorded. An electronic signature (step-up MFA) is required before the change runs.'

export function ReasonPromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [category, setCategory] = useState<ReasonCategoryValue>('data_correction')
  const [reason, setReason] = useState('')
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<SigningChallenge | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const changeId = useId()
  const noticeId = useId()
  const categoryId = useId()
  const reasonId = useId()
  const hashId = useId()

  useEffect(() => {
    registerReasonOpener(
      (options) =>
        new Promise<ReasonSubmission | null>((resolve) => {
          setCategory('data_correction')
          setReason('')
          setPrepared(null)
          setError(null)
          setChallenge(null)
          setBusy(false)
          setPending({ options, resolve })
        }),
    )
    return () => registerReasonOpener(null)
  }, [])

  useEffect(() => {
    if (!pending || challenge) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) finish(null)
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => reasonRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, busy, challenge])

  function finish(value: ReasonSubmission | null) {
    pending?.resolve(value)
    setPending(null)
    setReason('')
    setPrepared(null)
    setError(null)
    setChallenge(null)
    setBusy(false)
  }

  function applyChallengeFromBody(status: number, body: unknown): boolean {
    const next = classifySigningChallenge(status, body, {
      resumePath: window.location.pathname + window.location.search,
    })
    if (!next) return false
    setChallenge(next)
    setBusy(false)
    return true
  }

  async function prepareCeremony(text: string, cat: ReasonCategoryValue) {
    if (!pending) return
    setBusy(true)
    setError(null)
    setChallenge(null)
    try {
      const res = await fetch('/auth/sign/prepare-mutation', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: pending.options.method,
          path: pending.options.path.split('?')[0] ?? pending.options.path,
          reason: text,
          category: cat,
          // Must match the mutation body exactly or the BFF rejects the signature hash.
          body:
            pending.options.body && typeof pending.options.body === 'object'
              ? pending.options.body
              : {},
        }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (applyChallengeFromBody(res.status, body)) return
      if (!res.ok) {
        setError(
          typeof body.error === 'string' ? body.error : `Prepare failed (${res.status})`,
        )
        setBusy(false)
        return
      }
      setPrepared(body as unknown as Prepared)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prepare failed')
    } finally {
      setBusy(false)
    }
  }

  async function executeCeremony(text: string, cat: ReasonCategoryValue, prep: Prepared) {
    setBusy(true)
    setError(null)
    setChallenge(null)
    try {
      const res = await fetch('/auth/sign/execute', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: prep.content,
          meaning: 'Approved',
          expectedHash: prep.hash,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (applyChallengeFromBody(res.status, body)) return
      if (!res.ok) {
        setError(
          typeof body.error === 'string' ? body.error : `Signature failed (${res.status})`,
        )
        setBusy(false)
        return
      }
      const signature = body.signature as { id: string; changeControlId?: string } | undefined
      if (!signature?.id) {
        setError('Signature failed (missing id)')
        setBusy(false)
        return
      }
      finish({
        reason: text,
        category: cat,
        signatureId: signature.id,
        ...(signature.changeControlId
          ? { changeControlId: signature.changeControlId }
          : {}),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signature failed')
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = reason.trim()
    if (!text || !category || busy) return
    if (!prepared) {
      void prepareCeremony(text, category)
      return
    }
    void executeCeremony(text, category, prepared)
  }

  const canConfirm = reason.trim().length > 0 && !busy

  return (
    <>
      {children}
      {pending && challenge ? (
        <SigningChallengeInterstitial
          challenge={challenge}
          onDismiss={() => finish(null)}
          onContinue={() => {
            if (challenge.continueUrl) {
              window.location.assign(challenge.continueUrl)
            }
          }}
        />
      ) : null}
      {pending && !challenge ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) finish(null)
          }}
        >
          <form
            className="modal reason-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={`${changeId} ${noticeId}`}
            onSubmit={onSubmit}
          >
            <h2 id={titleId} className="modal-title">
              {prepared ? 'Electronic signature' : 'Reason and signature required'}
            </h2>

            <section className="reason-prompt-change" aria-labelledby={changeId}>
              <h3 id={changeId} className="reason-prompt-heading">
                What will change
              </h3>
              <p className="reason-prompt-summary">{pending.options.changeSummary}</p>
            </section>

            <p id={noticeId} className="reason-prompt-notice muted small">
              {GXP_NOTICE}
            </p>

            {pending.options.detail ? (
              <p className="reason-prompt-server muted small">{pending.options.detail}</p>
            ) : null}

            {!prepared ? (
              <>
                <label className="reason-prompt-label" htmlFor={categoryId}>
                  Category
                  <select
                    id={categoryId}
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ReasonCategoryValue)}
                    required
                    disabled={busy}
                  >
                    {REASON_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="reason-prompt-label" htmlFor={reasonId}>
                  Reason
                  <textarea
                    id={reasonId}
                    ref={reasonRef}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={PLACEHOLDER}
                    rows={4}
                    required
                    autoComplete="off"
                    disabled={busy}
                  />
                </label>
              </>
            ) : (
              <section className="reason-prompt-change" aria-labelledby={hashId}>
                <h3 id={hashId} className="reason-prompt-heading">
                  Review before signing
                </h3>
                <p className="muted small">
                  Meaning <strong>Approved</strong> · {prepared.principal.name}
                </p>
                <p className="muted small">
                  Category {category} · action {prepared.action}
                </p>
                <p className="muted small" style={{ wordBreak: 'break-all' }}>
                  Content hash <code className="inline-code">{prepared.hash}</code>
                </p>
                <p className="muted small">{reason}</p>
              </section>
            )}

            {error ? (
              <p className="flash flash-error" role="alert">
                {error}
              </p>
            ) : null}

            <p className="muted small">
              A change-control id is assigned automatically and stored with the signature and audit
              record.
            </p>

            <div className="btn-row modal-actions">
              <button type="button" className="btn ghost" onClick={() => finish(null)} disabled={busy}>
                <ActionX size={14} aria-hidden="true" className="button-label-icon" />
                Cancel
              </button>
              {prepared ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => {
                    setPrepared(null)
                    setError(null)
                  }}
                >
                  Back
                </button>
              ) : null}
              <button type="submit" className="btn primary" disabled={!canConfirm}>
                <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />
                {prepared ? 'Sign and continue' : 'Review signature'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
