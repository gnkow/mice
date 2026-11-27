import { Check as ActionCheck, X as ActionX } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import {
  acceptRepoTransfer,
  AuthzError,
  fetchIncomingTransfers,
  previewRepoTransfer,
  rejectRepoTransfer,
  type RepositoryTransferRecord,
  type TransferAccessDiff,
} from '../lib/authzApi'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import {
  SIGNED_MUTATION_COMPLETE_EVENT,
  type PendingSignedMutation,
} from '../lib/signingResume'
import { TransferAccessDiffView } from './TransferAccessDiff'

type Props = {
  namespace: string
  /** Dest namespace Owner chrome (manageSettings). */
  canManage: boolean
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

/**
 * Destination namespace settings inbox: accept / reject pending repository transfers.
 */
export function IncomingTransfersSection({ namespace, canManage }: Props) {
  const navigate = useNavigate()
  const headingId = useId()
  const state = useAsync(
    (signal) => fetchIncomingTransfers(namespace, signal),
    [namespace],
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({})
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [preview, setPreview] = useState<{
    id: string
    diff: TransferAccessDiff
  } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  const transfers = state.kind === 'ok' ? state.data : []

  useEffect(() => {
    function onComplete(e: Event) {
      const intent = (e as CustomEvent<PendingSignedMutation>).detail
      if (!intent) return
      const apiPath = intent.apiPath.split('?')[0] ?? intent.apiPath
      if (intent.method.toUpperCase() !== 'POST' || !apiPath.endsWith('/transfer/accept')) {
        return
      }
      const targetNs =
        intent.body &&
        typeof intent.body === 'object' &&
        'targetNamespace' in intent.body &&
        typeof (intent.body as { targetNamespace: unknown }).targetNamespace === 'string'
          ? (intent.body as { targetNamespace: string }).targetNamespace.trim()
          : namespace
      const parts = apiPath.split('/').filter(Boolean)
      // /auth/namespaces/:ns/repos/:repo/transfer/accept
      const repo = parts[4] ? decodeURIComponent(parts[4]) : ''
      if (!repo || !targetNs) return
      navigate(
        `/n/${encodeURIComponent(targetNs)}/r/${encodeURIComponent(repo)}/tree/main`,
      )
    }
    window.addEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
    return () => window.removeEventListener(SIGNED_MUTATION_COMPLETE_EVENT, onComplete)
  }, [namespace, navigate])

  async function startReview(t: RepositoryTransferRecord) {
    setReviewId(t.id)
    setConfirmed(false)
    setPreviewBusy(true)
    setError(null)
    try {
      const diff = await previewRepoTransfer(
        t.sourceNamespace,
        t.repositoryName,
        t.targetNamespace,
      )
      setPreview({ id: t.id, diff })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
      setReviewId(null)
    } finally {
      setPreviewBusy(false)
    }
  }

  async function onAccept(t: RepositoryTransferRecord) {
    if (reviewId !== t.id || !confirmed) {
      await startReview(t)
      return
    }
    setBusyId(t.id)
    setError(null)
    try {
      const res = await acceptRepoTransfer(t.sourceNamespace, t.repositoryName, {
        targetNamespace: t.targetNamespace,
      })
      const dest = res.repository?.namespace ?? t.targetNamespace
      const name = res.repository?.name ?? t.repositoryName
      navigate(
        `/n/${encodeURIComponent(dest)}/r/${encodeURIComponent(name)}/tree/main`,
      )
    } catch (err) {
      if (isCeremonyCancelled(err)) return
      setError(
        err instanceof AuthzError || err instanceof Error
          ? err.message
          : 'Accept failed',
      )
    } finally {
      setBusyId(null)
    }
  }

  async function onReject(t: RepositoryTransferRecord) {
    const reason = (rejectReason[t.id] ?? '').trim()
    if (reason.length < 10) {
      setError('Reject reason must be at least 10 characters')
      return
    }
    setBusyId(t.id)
    setError(null)
    try {
      await rejectRepoTransfer(t.sourceNamespace, t.repositoryName, reason)
      setRejectReason((prev) => {
        const next = { ...prev }
        delete next[t.id]
        return next
      })
      setReviewId(null)
      setConfirmed(false)
      setPreview(null)
      state.reload()
    } catch (err) {
      setError(
        err instanceof AuthzError || err instanceof Error
          ? err.message
          : 'Reject failed',
      )
    } finally {
      setBusyId(null)
    }
  }

  if (!canManage && transfers.length === 0 && state.kind !== 'loading') {
    return null
  }

  return (
    <section
      id="ns-incoming-transfers"
      className="settings-section"
      aria-labelledby={headingId}
    >
      <div className="ns-settings-section-head">
        <div>
          <h2 id={headingId}>Incoming transfers</h2>
          <p className="muted small">
            Repositories proposed into this namespace. Accepting completes the
            move and applies the access filter; rejecting leaves the repo in its
            source namespace.
          </p>
        </div>
        <p className="muted small ns-settings-count">
          {transfers.length} pending
        </p>
      </div>

      {error ? (
        <p className="flash flash-error" role="status">
          {error}
        </p>
      ) : null}

      {state.kind === 'loading' ? (
        <p className="muted small" role="status" aria-live="polite">
          Loading incoming transfers…
        </p>
      ) : null}
      {state.kind === 'error' ? (
        <div className="flash flash-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn ghost" onClick={() => state.reload()}>
            Retry
          </button>
        </div>
      ) : null}

      {state.kind === 'ok' && transfers.length === 0 ? (
        <p className="muted small">No pending transfers into this namespace.</p>
      ) : null}

      {transfers.length > 0 ? (
        <ul className="ns-member-list transfer-inbox-list">
          {transfers.map((t) => {
            const busy = busyId === t.id
            const reviewing = reviewId === t.id
            return (
              <li key={t.id} className="ns-member-row transfer-inbox-row">
                <div className="ns-member-main">
                  <p className="transfer-inbox-title">
                    <Link
                      to={`/n/${encodeURIComponent(t.sourceNamespace)}/r/${encodeURIComponent(t.repositoryName)}/settings#repo-transfer`}
                    >
                      {t.sourceNamespace}/{t.repositoryName}
                    </Link>
                  </p>
                  <p className="muted small">
                    Proposed {formatWhen(t.createdAt)}
                    {t.expiresAt ? ` · expires ${formatWhen(t.expiresAt)}` : ''}
                  </p>
                </div>
                {canManage ? (
                  <div className="transfer-inbox-actions">
                    {reviewing ? (
                      <>
                        <TransferAccessDiffView
                          diff={preview?.id === t.id ? preview.diff : null}
                          loading={previewBusy}
                        />
                        <label className="ns-settings-toggle">
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                            disabled={busy || previewBusy}
                          />
                          <span className="ns-settings-label">
                            I understand the access changes
                          </span>
                        </label>
                        <div className="btn-row">
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busy || previewBusy || !confirmed}
                            onClick={() => void onAccept(t)}
                          >
                            <ActionCheck
                              size={14}
                              aria-hidden="true"
                              className="button-label-icon"
                            />
                            Accept transfer
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={busy}
                            onClick={() => {
                              setReviewId(null)
                              setConfirmed(false)
                              setPreview(null)
                            }}
                          >
                            Back
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy}
                        onClick={() => void startReview(t)}
                      >
                        <ActionCheck
                          size={14}
                          aria-hidden="true"
                          className="button-label-icon"
                        />
                        Review &amp; accept
                      </button>
                    )}
                    <label className="ns-settings-field">
                      <span className="ns-settings-label">Reject reason</span>
                      <input
                        value={rejectReason[t.id] ?? ''}
                        onChange={(e) =>
                          setRejectReason((prev) => ({
                            ...prev,
                            [t.id]: e.target.value,
                          }))
                        }
                        placeholder="At least 10 characters"
                        disabled={busy}
                        minLength={10}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy || (rejectReason[t.id] ?? '').trim().length < 10}
                      onClick={() => void onReject(t)}
                    >
                      <ActionX
                        size={14}
                        aria-hidden="true"
                        className="button-label-icon"
                      />
                      Reject
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
