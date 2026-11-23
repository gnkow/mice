import { Check as ActionCheck, X as ActionX } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { SigningChallengeInterstitial } from './SigningChallengeInterstitial'
import { StateBlock } from './StateBlock'
import { UserRef } from './UserRef'
import { useAsync } from '../hooks/useAsync'
import {
  CEREMONY_NOTICE,
  CHANGE_CONTROL_ID_HINT,
  isValidChangeControlId,
  suggestChangeControlId,
} from '../lib/reasonPrompt'
import {
  classifySigningChallenge,
  type SigningChallenge,
} from '../lib/signingChallenge'
import { continueToSigningReauth, pageResumePath } from '../lib/signingResume'
import {
  completeSignedMergeRequest,
  executeMergeSignature,
  fetchSigningPreview,
  mergeRefusalMessage,
} from '../lib/mergeRequests'

const PLACEHOLDER = 'Why are you approving this merge into the validated branch?'

type Props = {
  mergeRequestId: string
  namespace: string
  repo: string
  /**
   * Modal shell (list Sign). Matches `ReasonPromptProvider` backdrop + form.
   * Page route uses the same form body without the overlay.
   */
  embedded?: boolean
  onDismiss?: () => void
  onComplete?: () => void
}

/**
 * GxP merge signing ceremony — same UX shell as rename (`ReasonPromptProvider`),
 * with merge-bound preview (heads + manifest) instead of prepare-mutation.
 */
export function MergeRequestSignPanel({
  mergeRequestId,
  namespace,
  repo,
  embedded = false,
  onDismiss,
  onComplete,
}: Props) {
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  const preview = useAsync(
    (signal) => fetchSigningPreview(mergeRequestId, signal),
    [mergeRequestId],
  )

  const [reason, setReason] = useState('')
  const [changeControlId, setChangeControlId] = useState(() => suggestChangeControlId())
  const [confirmedHash, setConfirmedHash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<SigningChallenge | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const changeId = useId()
  const noticeId = useId()
  const reasonId = useId()
  const ccId = useId()
  const hashId = useId()

  useEffect(() => {
    if (!embedded || challenge) return
    const t = window.setTimeout(() => reasonRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [embedded, challenge, preview.kind])

  function applyChallenge(status: number, body: unknown): boolean {
    const next = classifySigningChallenge(status, body, {
      resumePath: pageResumePath(),
    })
    if (!next) return false
    setChallenge(next)
    setBusy(false)
    return true
  }

  function onReview(e: FormEvent) {
    e.preventDefault()
    if (
      !reason.trim() ||
      reason.trim().length < 10 ||
      !isValidChangeControlId(changeControlId) ||
      preview.kind !== 'ok' ||
      busy
    ) {
      return
    }
    setError(null)
    setChallenge(null)
    setConfirmedHash(preview.data.hash)
  }

  async function onSignAndComplete() {
    if (preview.kind !== 'ok' || !confirmedHash || busy) return
    const data = preview.data
    if (confirmedHash !== data.hash) {
      setError(
        mergeRefusalMessage(
          'binding_mismatch',
          'Content changed after display; signature invalidated',
        ),
      )
      setConfirmedHash(null)
      return
    }
    setBusy(true)
    setError(null)
    setChallenge(null)
    try {
      let signature: { id: string; changeControlId?: string }
      try {
        signature = await executeMergeSignature({
          content: data.manifest ?? data.content ?? '',
          expectedHash: data.hash,
          binding: data.binding,
          manifest: data.manifest ?? data.content ?? '',
          changeControlId: changeControlId.trim(),
        })
      } catch (err) {
        const status =
          err && typeof err === 'object' && 'status' in err
            ? Number((err as { status: number }).status)
            : 0
        const body =
          err && typeof err === 'object' && 'body' in err
            ? (err as { body: unknown }).body
            : {}
        if (applyChallenge(status, body)) return
        if (status === 409) {
          setError(
            typeof body === 'object' &&
              body &&
              'error' in body &&
              typeof (body as { error: unknown }).error === 'string'
              ? (body as { error: string }).error
              : 'This change-control id was already used',
          )
          setConfirmedHash(null)
          setBusy(false)
          return
        }
        if (
          err instanceof Error &&
          /content changed after display/i.test(err.message)
        ) {
          setError(mergeRefusalMessage('binding_mismatch', err.message))
          setConfirmedHash(null)
          setBusy(false)
          return
        }
        throw err
      }

      const live = await fetchSigningPreview(mergeRequestId)
      if (live.hash !== confirmedHash) {
        setError(
          mergeRefusalMessage(
            'binding_mismatch',
            'Content changed after display; signature invalidated',
          ),
        )
        setConfirmedHash(null)
        setBusy(false)
        preview.reload()
        return
      }

      const result = await completeSignedMergeRequest(mergeRequestId, {
        liveSourceHead: live.mergeRequest.expectedSourceHead,
        liveTargetHead: live.mergeRequest.expectedTargetHead,
        authors: [],
        commitIds: [],
        signatureId: signature.id,
        reason: reason.trim(),
        changeControlId:
          signature.changeControlId?.trim() || changeControlId.trim(),
      })
      setSuccess(
        `Signed merge completed · ${result.mergeCommitId.slice(0, 8)}`,
      )
      preview.reload()
      onComplete?.()
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : undefined
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 0
      // Prefer the refusal code from complete (e.g. restore_test_required). Only
      // fall back to audit_unavailable for opaque 503s with no code.
      setError(
        mergeRefusalMessage(
          code ?? (status === 503 ? 'audit_unavailable' : undefined),
          err instanceof Error ? err.message : 'Signed merge failed',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const reviewing = confirmedHash != null
  const hashStale =
    reviewing && preview.kind === 'ok' && confirmedHash !== preview.data.hash
  const canReview =
    reason.trim().length >= 10 &&
    isValidChangeControlId(changeControlId) &&
    !busy &&
    preview.kind === 'ok'

  const changeSummary =
    preview.kind === 'ok'
      ? `Approve merge ${preview.data.mergeRequest.sourceBranch} → ${preview.data.mergeRequest.targetBranch} on ${namespace}/${repo}`
      : `Approve merge request on ${namespace}/${repo}`

  const form = (
    <form
      className={embedded ? 'modal reason-prompt' : 'reason-prompt'}
      role={embedded ? 'dialog' : undefined}
      aria-modal={embedded ? true : undefined}
      aria-labelledby={titleId}
      aria-describedby={
        !success && !reviewing ? `${changeId} ${noticeId}` : changeId
      }
      onSubmit={onReview}
    >
      <h2 id={titleId} className="modal-title">
        {reviewing && !hashStale ? 'Electronic signature' : 'Signature Required'}
      </h2>

      <section className="reason-prompt-change" aria-labelledby={changeId}>
        <h3 id={changeId} className="reason-prompt-heading">
          Change
        </h3>
        <p className="reason-prompt-summary">{changeSummary}</p>
        {preview.kind === 'ok' && !preview.data.validatedTarget ? (
          <p className="flash flash-warning" role="status">
            Target is not a validated branch; unsigned merge may be used instead.
          </p>
        ) : null}
        {!embedded && preview.kind === 'ok' ? (
          <p className="muted small">
            <Link
              to={`${base}/merge?base=${encodeURIComponent(preview.data.mergeRequest.targetBranch)}&head=${encodeURIComponent(preview.data.mergeRequest.sourceBranch)}`}
            >
              Compare on Merge
            </Link>
          </p>
        ) : null}
      </section>

      {hashStale ? (
        <div className="flash flash-error" role="alert">
          <h3 className="reason-prompt-heading">There is a problem</h3>
          <p>
            {mergeRefusalMessage(
              'binding_mismatch',
              'Content changed after display; signature invalidated',
            )}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => setConfirmedHash(null)}
          >
            Review again
          </button>
        </div>
      ) : null}

      {!success && !reviewing ? (
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
      ) : null}

      {!success && reviewing && !hashStale && preview.kind === 'ok' ? (
        <section className="reason-prompt-change" aria-labelledby={hashId}>
          <h3 id={hashId} className="reason-prompt-heading">
            Review before signing
          </h3>
          <p className="muted small">
            Meaning <strong>Approved</strong> ·{' '}
            <UserRef
              author={`${preview.data.principal.iss}|${preview.data.principal.sub}`}
              name={preview.data.principal.name}
            />
          </p>
          <p className="muted small">
            Change-control {changeControlId.trim()} · heads{' '}
            {preview.data.mergeRequest.expectedSourceHead.slice(0, 8)} /{' '}
            {preview.data.mergeRequest.expectedTargetHead.slice(0, 8)}
          </p>
          <p className="muted small" style={{ wordBreak: 'break-all' }}>
            Content hash <code className="inline-code">{preview.data.hash}</code>
          </p>
          <p className="muted small">{reason}</p>
        </section>
      ) : null}

      {error && !hashStale ? (
        <p className="flash flash-error" role="alert">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="flash flash-success" role="status">
          {success}
        </p>
      ) : null}

      {!success ? (
        <div className="btn-row modal-actions">
          {reviewing && !hashStale ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setConfirmedHash(null)
                setError(null)
              }}
            >
              Back
            </button>
          ) : null}
          {embedded && onDismiss ? (
            <button
              type="button"
              className="btn ghost"
              onClick={onDismiss}
              disabled={busy}
            >
              <ActionX size={14} aria-hidden="true" className="button-label-icon" />
              Cancel
            </button>
          ) : null}
          <div className="reason-prompt-actions-signer">
            {!reviewing ? (
              <button type="submit" className="btn primary" disabled={!canReview}>
                <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />
                Sign
              </button>
            ) : !hashStale ? (
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void onSignAndComplete()}
              >
                <ActionCheck size={14} aria-hidden="true" className="button-label-icon" />
                {busy ? 'Signing…' : 'Sign'}
              </button>
            ) : null}
            {preview.kind === 'ok' ? (
              <>
                <span className="reason-prompt-actions-as">as</span>
                <UserRef
                  author={`${preview.data.principal.iss}|${preview.data.principal.sub}`}
                  name={preview.data.principal.name}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  )

  return (
    <>
      {challenge ? (
        <SigningChallengeInterstitial
          challenge={challenge}
          onDismiss={() => setChallenge(null)}
          onContinue={() => {
            if (challenge.continueUrl) continueToSigningReauth(challenge.continueUrl)
          }}
        />
      ) : null}

      {embedded ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) onDismiss?.()
          }}
        >
          {preview.kind === 'ok' ? (
            form
          ) : (
            <div className="modal reason-prompt" role="status">
              <StateBlock
                loading={preview.kind === 'loading'}
                error={preview.kind === 'error' ? preview.message : null}
                onRetry={() => preview.reload()}
              >
                {null}
              </StateBlock>
            </div>
          )}
        </div>
      ) : (
        <StateBlock
          loading={preview.kind === 'loading'}
          error={preview.kind === 'error' ? preview.message : null}
          onRetry={() => preview.reload()}
        >
          {preview.kind === 'ok' ? form : null}
        </StateBlock>
      )}
    </>
  )
}
