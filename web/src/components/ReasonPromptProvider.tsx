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
  CEREMONY_NOTICE,
  CHANGE_CONTROL_ID_HINT,
  isValidChangeControlId,
  registerReasonOpener,
  suggestChangeControlId,
  suggestReasonCategory,
  type ReasonCategoryValue,
  type ReasonPromptOptions,
  type ReasonSubmission,
} from '../lib/reasonPrompt'
import { fetchAuthMe } from '../lib/auth'
import { UserRef } from './UserRef'
import {
  classifySigningChallenge,
  mfaRequiredChallenge,
  type SigningChallenge,
} from '../lib/signingChallenge'
import {
  continueToSigningReauth,
  dispatchSignedMutationComplete,
  ensureResumeSignedMutation,
  pageResumePath,
  takeCeremonyResumeDraft,
} from '../lib/signingResume'
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

export function ReasonPromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [category, setCategory] = useState<ReasonCategoryValue>('other')
  const [reason, setReason] = useState('')
  const [changeControlId, setChangeControlId] = useState('')
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [signer, setSigner] = useState<{
    iss: string
    sub: string
    name: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<SigningChallenge | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const changeId = useId()
  const noticeId = useId()
  const reasonId = useId()
  const ccId = useId()
  const hashId = useId()

  useEffect(() => {
    registerReasonOpener(
      (options) =>
        new Promise<ReasonSubmission | null>((resolve) => {
          const draft = takeCeremonyResumeDraft()
          setCategory(
            draft?.category ??
              suggestReasonCategory({
                method: options.method,
                path: options.path,
                changeSummary: options.changeSummary,
              }),
          )
          setReason(draft?.reason ?? '')
          setChangeControlId(draft?.changeControlId ?? suggestChangeControlId())
          setPrepared(null)
          setSigner(null)
          setError(null)
          setChallenge(null)
          setBusy(false)
          setPending({ options, resolve })
          // Gate before reason entry: no MFA evidence → Complete MFA interstitial.
          void fetchAuthMe()
            .then((me) => {
              if (!me.authenticated) return
              setSigner({
                iss: me.user.iss,
                sub: me.user.sub,
                name: me.user.name,
              })
              if (me.user.mfaEvidenced !== false) return
              setChallenge(mfaRequiredChallenge(pageResumePath()))
            })
            .catch(() => {
              /* network blip: prepare/execute still refuse without MFA */
            })
        }),
    )
    return () => registerReasonOpener(null)
  }, [])

  // After IdP MFA/step-up, replay the interrupted mutation so the ceremony reopens
  // without requiring another Approve / Grant click.
  useEffect(() => {
    const resume = ensureResumeSignedMutation(pageResumePath())
    if (!resume) return
    let cancelled = false
    void resume.promise
      .then((res) => {
        if (cancelled || !res.ok) return
        dispatchSignedMutationComplete(resume.intent)
      })
      .catch(() => {
        /* user cancelled ceremony or mutation failed — page shows its own errors on retry */
      })
    return () => {
      cancelled = true
    }
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
    setChangeControlId('')
    setPrepared(null)
    setSigner(null)
    setError(null)
    setChallenge(null)
    setBusy(false)
  }

  function applyChallengeFromBody(status: number, body: unknown): boolean {
    const next = classifySigningChallenge(status, body, {
      resumePath: pageResumePath(),
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
      const me = await fetchAuthMe()
      if (me.authenticated && me.user.mfaEvidenced === false) {
        setChallenge(mfaRequiredChallenge(pageResumePath()))
        setBusy(false)
        return
      }
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

  async function executeCeremony(
    text: string,
    cat: ReasonCategoryValue,
    prep: Prepared,
    cc: string,
  ) {
    setBusy(true)
    setError(null)
    setChallenge(null)
    try {
      const me = await fetchAuthMe()
      if (me.authenticated && me.user.mfaEvidenced === false) {
        setChallenge(mfaRequiredChallenge(pageResumePath()))
        setBusy(false)
        return
      }
      const res = await fetch('/auth/sign/execute', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: prep.content,
          meaning: 'Approved',
          expectedHash: prep.hash,
          changeControlId: cc,
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
        changeControlId: signature.changeControlId?.trim() || cc,
        signatureId: signature.id,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signature failed')
      setBusy(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = reason.trim()
    const cc = changeControlId.trim()
    if (text.length < 10 || !isValidChangeControlId(cc) || !category || busy) return
    if (!prepared) {
      void prepareCeremony(text, category)
      return
    }
    void executeCeremony(text, category, prepared, cc)
  }

  const canConfirm =
    reason.trim().length >= 10 && isValidChangeControlId(changeControlId) && !busy
  const actionsSigner = prepared?.principal ?? signer

  return (
    <>
      {children}
      {pending && challenge ? (
        <SigningChallengeInterstitial
          challenge={challenge}
          onDismiss={() => finish(null)}
          onContinue={() => {
            if (!challenge.continueUrl || !pending) return
            continueToSigningReauth(challenge.continueUrl, {
              path: pageResumePath(),
              method: pending.options.method,
              apiPath: pending.options.path,
              body: pending.options.body,
              changeSummary: pending.options.changeSummary,
              ...(reason.trim()
                ? {
                    draftReason: reason.trim(),
                    draftCategory: category,
                    draftChangeControlId: changeControlId.trim() || undefined,
                  }
                : {}),
            })
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
            aria-describedby={
              !prepared ? `${changeId} ${noticeId}` : changeId
            }
            onSubmit={onSubmit}
          >
            <h2 id={titleId} className="modal-title">
              {prepared ? 'Electronic signature' : 'Signature Required'}
            </h2>

            <section className="reason-prompt-change" aria-labelledby={changeId}>
              <h3 id={changeId} className="reason-prompt-heading">
                Change
              </h3>
              <p className="reason-prompt-summary">{pending.options.changeSummary}</p>
            </section>

            {!prepared ? (
              <>
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
                    minLength={10}
                    autoComplete="off"
                    disabled={busy}
                  />
                </label>
                <p id={noticeId} className="reason-prompt-notice muted small">
                  {CEREMONY_NOTICE}
                </p>

                <label className="reason-prompt-label" htmlFor={ccId}>
                  Change-control id
                  <input
                    id={ccId}
                    type="text"
                    value={changeControlId}
                    onChange={(e) => setChangeControlId(e.target.value)}
                    placeholder="CC-YYYYMMDD-xxxxxxxx"
                    required
                    minLength={3}
                    maxLength={128}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    aria-describedby={`${ccId}-hint`}
                  />
                  <span id={`${ccId}-hint`} className="reason-prompt-field-hint muted small">
                    {CHANGE_CONTROL_ID_HINT}
                  </span>
                </label>
              </>
            ) : (
              <section className="reason-prompt-change" aria-labelledby={hashId}>
                <h3 id={hashId} className="reason-prompt-heading">
                  Review before signing
                </h3>
                <p className="muted small">
                  Meaning <strong>Approved</strong> ·{' '}
                  <UserRef
                    author={`${prepared.principal.iss}|${prepared.principal.sub}`}
                    name={prepared.principal.name}
                  />
                </p>
                <p className="muted small">
                  Change-control {changeControlId.trim()} · action {prepared.action}
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

            <div className="btn-row modal-actions">
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
              <button type="button" className="btn ghost" onClick={() => finish(null)} disabled={busy}>
                <ActionX size={14} aria-hidden="true" className="button-label-icon" />
                Cancel
              </button>
              <div className="reason-prompt-actions-signer">
                <button type="submit" className="btn primary" disabled={!canConfirm}>
                  <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />
                  Sign
                </button>
                {actionsSigner ? (
                  <>
                    <span className="reason-prompt-actions-as">as</span>
                    <UserRef
                      author={`${actionsSigner.iss}|${actionsSigner.sub}`}
                      name={actionsSigner.name}
                    />
                  </>
                ) : null}
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
