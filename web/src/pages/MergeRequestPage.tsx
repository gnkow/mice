import { GitMerge as ActionGitMerge } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { BranchesSubNav } from '../components/BranchesSubNav'
import { SigningChallengeInterstitial } from '../components/SigningChallengeInterstitial'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  REASON_CATEGORIES,
  type ReasonCategoryValue,
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
  type MergeSigningPreview,
} from '../lib/mergeRequests'

const PLACEHOLDER = 'Why are you approving this merge into the validated branch?'

/**
 * GxP #92 — merge-request signing ceremony: content hash, meaning Approved,
 * printed name, reason + change-control, browser step-up, clear refusals.
 */
export function MergeRequestPage() {
  const { namespace = '', repo = '', mergeRequestId = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`

  const preview = useAsync(
    (signal) => fetchSigningPreview(mergeRequestId, signal),
    [mergeRequestId],
  )

  const [category, setCategory] = useState<ReasonCategoryValue>('other')
  const [reason, setReason] = useState('')
  const [changeControlId, setChangeControlId] = useState('')
  const [confirmedHash, setConfirmedHash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<SigningChallenge | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const reasonId = useId()
  const categoryId = useId()
  const hashId = useId()
  const ccId = useId()

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  function applyChallenge(status: number, body: unknown): boolean {
    const next = classifySigningChallenge(status, body, {
      resumePath: pageResumePath(),
    })
    if (!next) return false
    setChallenge(next)
    setBusy(false)
    return true
  }

  async function onReview(e: FormEvent) {
    e.preventDefault()
    if (!reason.trim() || preview.kind !== 'ok' || busy) return
    setError(null)
    setChallenge(null)
    // Freeze the displayed hash; complete refuses if tips/content drift.
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
          content: data.content,
          expectedHash: data.hash,
          binding: data.binding,
          manifest: data.manifest,
          ...(changeControlId.trim()
            ? { changeControlId: changeControlId.trim() }
            : {}),
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
        if (
          err instanceof Error &&
          /content changed after display/i.test(err.message)
        ) {
          setError(
            mergeRefusalMessage('binding_mismatch', err.message),
          )
          setConfirmedHash(null)
          setBusy(false)
          return
        }
        throw err
      }

      // Re-fetch preview so a tip move after display is caught before complete.
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
        manifestEntries: live.manifestEntries,
        reason: reason.trim(),
        category,
        changeControlId:
          changeControlId.trim() || signature.changeControlId || undefined,
      })
      setSuccess(
        `Signed merge completed · ${result.mergeCommitId.slice(0, 8)}`,
      )
      preview.reload()
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : undefined
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 0
      if (status === 503) {
        setError(
          mergeRefusalMessage(
            'audit_unavailable',
            err instanceof Error ? err.message : 'Audit unavailable',
          ),
        )
      } else {
        setError(
          mergeRefusalMessage(
            code,
            err instanceof Error ? err.message : 'Signed merge failed',
          ),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <BranchesSubNav />
      <div className="page-head">
        <div>
          <h1 id={titleId}>
            <ActionGitMerge
              size={20}
              aria-hidden="true"
              className="button-label-icon"
            />
            Sign merge request
          </h1>
          <p className="lede">
            Review the merge content hash, confirm meaning <strong>Approved</strong>,
            then complete step-up MFA. The CLI can open a merge request and print this
            page link; signing happens only in the browser.
          </p>
        </div>
        <Link className="btn ghost" to={`${base}/merge-requests`}>
          All merge requests
        </Link>
      </div>

      {challenge ? (
        <SigningChallengeInterstitial
          challenge={challenge}
          onDismiss={() => setChallenge(null)}
          onContinue={() => {
            if (challenge.continueUrl) continueToSigningReauth(challenge.continueUrl)
          }}
        />
      ) : null}

      <StateBlock
        loading={preview.kind === 'loading'}
        error={preview.kind === 'error' ? preview.message : null}
        onRetry={() => preview.reload()}
      >
        {preview.kind === 'ok' ? (
          <SigningForm
            data={preview.data}
            base={base}
            category={category}
            setCategory={setCategory}
            reason={reason}
            setReason={setReason}
            changeControlId={changeControlId}
            setChangeControlId={setChangeControlId}
            confirmedHash={confirmedHash}
            setConfirmedHash={setConfirmedHash}
            busy={busy}
            error={error}
            success={success}
            reasonRef={reasonRef}
            errorRef={errorRef}
            reasonId={reasonId}
            categoryId={categoryId}
            hashId={hashId}
            ccId={ccId}
            onReview={onReview}
            onSignAndComplete={() => void onSignAndComplete()}
          />
        ) : null}
      </StateBlock>
    </main>
  )
}

function SigningForm({
  data,
  base,
  category,
  setCategory,
  reason,
  setReason,
  changeControlId,
  setChangeControlId,
  confirmedHash,
  setConfirmedHash,
  busy,
  error,
  success,
  reasonRef,
  errorRef,
  reasonId,
  categoryId,
  hashId,
  ccId,
  onReview,
  onSignAndComplete,
}: {
  data: MergeSigningPreview
  base: string
  category: ReasonCategoryValue
  setCategory: (v: ReasonCategoryValue) => void
  reason: string
  setReason: (v: string) => void
  changeControlId: string
  setChangeControlId: (v: string) => void
  confirmedHash: string | null
  setConfirmedHash: (v: string | null) => void
  busy: boolean
  error: string | null
  success: string | null
  reasonRef: RefObject<HTMLTextAreaElement | null>
  errorRef: RefObject<HTMLDivElement | null>
  reasonId: string
  categoryId: string
  hashId: string
  ccId: string
  onReview: (e: FormEvent) => void
  onSignAndComplete: () => void
}) {
  const mr = data.mergeRequest
  const reviewing = confirmedHash != null
  const hashStale = reviewing && confirmedHash !== data.hash

  return (
    <section className="settings-section" aria-labelledby={hashId}>
      <div className="ns-settings-section-head">
        <div>
          <h2 id={hashId}>
            {mr.sourceBranch} → {mr.targetBranch}
          </h2>
          <p className="muted small">
            Status <strong>{mr.status}</strong>
            {' · '}
            <Link to={`${base}/merge?base=${encodeURIComponent(mr.targetBranch)}&head=${encodeURIComponent(mr.sourceBranch)}`}>
              Compare on Merge
            </Link>
          </p>
          {!data.validatedTarget ? (
            <p className="flash flash-warning" role="status">
              Target is not a validated branch; unsigned merge may be used instead.
            </p>
          ) : null}
        </div>
      </div>

      <div className="ns-settings-grid" style={{ marginBottom: '1rem' }}>
        <div className="ns-settings-field">
          <span className="ns-settings-label">Meaning</span>
          <p>
            <strong>Approved</strong>
          </p>
        </div>
        <div className="ns-settings-field">
          <span className="ns-settings-label">Printed name</span>
          <p>{data.principal.name}</p>
          <p className="muted small mono">
            {data.principal.iss}|{data.principal.sub}
          </p>
        </div>
        <div className="ns-settings-field">
          <span className="ns-settings-label">Content hash</span>
          <p className="mono small" style={{ wordBreak: 'break-all' }}>
            {data.hash}
          </p>
          <p className="muted small">
            Source {mr.expectedSourceHead.slice(0, 8)} · target{' '}
            {mr.expectedTargetHead.slice(0, 8)}
          </p>
        </div>
      </div>

      {hashStale ? (
        <div className="flash flash-error" role="alert" tabIndex={-1} ref={errorRef}>
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

      {error && !hashStale ? (
        <div
          className="flash flash-error"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
          style={{ marginBottom: '1rem' }}
        >
          <h3 className="reason-prompt-heading">There is a problem</h3>
          <p>{error}</p>
        </div>
      ) : null}

      {success ? (
        <p className="flash flash-success" role="status">
          {success}
        </p>
      ) : null}

      {!success && !reviewing ? (
        <form className="reason-prompt" onSubmit={onReview}>
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
                <option key={c.value} value={c.value} title={c.hint}>
                  {c.label} — {c.hint}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">{REASON_CATEGORIES.find((c) => c.value === category)?.hint}</p>

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

          <label className="reason-prompt-label" htmlFor={ccId}>
            Change-control id (optional)
            <input
              id={ccId}
              value={changeControlId}
              onChange={(e) => setChangeControlId(e.target.value)}
              autoComplete="off"
              disabled={busy}
              placeholder="Minted automatically when empty"
            />
          </label>

          <p className="muted small">
            Under GxP, who approved this merge and why is permanently recorded. An
            electronic signature (step-up MFA) is required before the merge runs.
          </p>

          <div className="btn-row">
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !reason.trim()}
            >
              Review signature
            </button>
          </div>
        </form>
      ) : null}

      {!success && reviewing && !hashStale ? (
        <div className="btn-row">
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => setConfirmedHash(null)}
          >
            Back
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={onSignAndComplete}
          >
            {busy ? 'Signing…' : 'Sign and complete merge'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
