import {
  BadgeCheck as ActionBadgeCheck,
  CircleAlert as ActionCircleAlert,
  CircleCheck as ActionCircleCheck,
} from 'lucide-react'
import { useState } from 'react'
import { useAsync } from '../hooks/useAsync'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import { qcStatusPillLabel, type CommitQcStatus } from '../lib/commitQc'
import { signerAuthoredCommit, type DispositionValue } from '../lib/disposition'
import {
  fetchCommitDisposition,
  postCommitDisposition,
} from '../lib/dispositionApi'
import { usePrincipalProfiles } from './CommitEmail'
import { Modal } from './Modal'
import { UserRef } from './UserRef'

type Props = {
  namespace: string
  repo: string
  commitId: string
  /** Commit author (`iss|sub` or equivalent). */
  author: string
  /** Commit-stored email — used for UserRef label when profiles are cold. */
  authorEmail?: string | null
  currentQc: CommitQcStatus | undefined
  signer: { iss: string; sub: string } | null | undefined
  onDone?: () => void
  /** Extra class on the open button (e.g. `btn ghost small`). */
  buttonClassName?: string
}

/**
 * Ad-hoc Valid/Invalid QC control (ADR 0009): action button + modal.
 * Status / history live outside this control (commit detail QC tab).
 */
export function CommitDispositionPanel({
  namespace,
  repo,
  commitId,
  author,
  authorEmail = null,
  currentQc,
  signer,
  onDone,
  buttonClassName = 'btn ghost small',
}: Props) {
  const [open, setOpen] = useState(false)
  const profiles = usePrincipalProfiles(author ? [author] : [])
  const authored = signerAuthoredCommit(signer, author)
  const [pick, setPick] = useState<DispositionValue>(() =>
    authored ? 'invalid' : 'valid',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detail = useAsync(
    (signal) =>
      open
        ? fetchCommitDisposition(namespace, repo, commitId, signal)
        : Promise.resolve(null),
    [namespace, repo, commitId, open],
  )

  const status =
    detail.kind === 'ok' && detail.data ? detail.data.status : currentQc
  const effectivePick = authored && pick === 'valid' ? 'invalid' : pick

  function openModal() {
    setError(null)
    setPick(authored ? 'invalid' : status === 'invalid' ? 'invalid' : 'valid')
    setOpen(true)
  }

  async function onSubmit() {
    if (busy) return
    if (authored && effectivePick === 'valid') {
      setError('You cannot set Valid on a commit you authored.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await postCommitDisposition(namespace, repo, { [commitId]: effectivePick })
      setOpen(false)
      onDone?.()
    } catch (err) {
      if (isCeremonyCancelled(err)) return
      setError(err instanceof Error ? err.message : 'QC change failed')
    } finally {
      setBusy(false)
    }
  }

  const statusClass =
    status === 'valid'
      ? 'ns-tag ns-tag-accent'
      : status === 'invalid'
        ? 'ns-tag ns-tag-warn'
        : 'ns-tag ns-tag-muted'

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={openModal}
        data-testid="adhoc-disposition-open"
      >
        <ActionBadgeCheck size={14} aria-hidden="true" className="button-label-icon" />
        Change QC
      </button>

      {open ? (
        <Modal title="Change QC" onClose={() => { if (!busy) setOpen(false) }}>
          <div className="commit-disposition-modal" data-testid="commit-disposition-modal">
            <p className="commit-disposition-lead muted small">
              Sign to set this commit’s quality-control disposition.
            </p>

            <dl className="commit-disposition-summary">
              <div>
                <dt>Commit</dt>
                <dd>
                  <code className="mono" title={commitId}>
                    {commitId.slice(0, 12)}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Current</dt>
                <dd>
                  <span className={statusClass}>{qcStatusPillLabel(status)}</span>
                </dd>
              </div>
              {author?.trim() ? (
                <div>
                  <dt>Author</dt>
                  <dd>
                    <UserRef
                      author={author}
                      storedEmail={authorEmail}
                      profiles={profiles}
                      interactive={false}
                    />
                  </dd>
                </div>
              ) : null}
            </dl>

            <fieldset className="disposition-choice-grid" disabled={busy}>
              <legend className="section-label">New status</legend>
              <label
                className={
                  effectivePick === 'valid'
                    ? 'disposition-choice is-selected'
                    : 'disposition-choice'
                }
              >
                <input
                  type="radio"
                  name={`adhoc-disposition-${commitId}`}
                  checked={effectivePick === 'valid'}
                  disabled={busy || authored}
                  onChange={() => setPick('valid')}
                  data-testid="adhoc-disposition-valid"
                />
                <ActionCircleCheck
                  size={18}
                  aria-hidden="true"
                  className="disposition-choice-icon is-valid"
                />
                <span className="disposition-choice-copy">
                  <strong>Valid</strong>
                  <span className="muted small">
                    Suitable for regulated release when covered.
                  </span>
                </span>
              </label>
              <label
                className={
                  effectivePick === 'invalid'
                    ? 'disposition-choice is-selected is-warn'
                    : 'disposition-choice'
                }
              >
                <input
                  type="radio"
                  name={`adhoc-disposition-${commitId}`}
                  checked={effectivePick === 'invalid'}
                  disabled={busy}
                  onChange={() => setPick('invalid')}
                  data-testid="adhoc-disposition-invalid"
                />
                <ActionCircleAlert
                  size={18}
                  aria-hidden="true"
                  className="disposition-choice-icon is-invalid"
                />
                <span className="disposition-choice-copy">
                  <strong>Invalid</strong>
                  <span className="muted small">
                    Soft flag — pins and jobs may still use it.
                  </span>
                </span>
              </label>
            </fieldset>

            {authored ? (
              <p className="muted small disposition-author-note" role="note">
                You authored this commit — Valid is disabled.
              </p>
            ) : null}

            {error ? (
              <p className="flash flash-error small" role="alert">
                {error}
              </p>
            ) : null}

            <div className="btn-row modal-actions">
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
                onClick={() => void onSubmit()}
                data-testid="adhoc-disposition-submit"
              >
                {busy ? 'Signing…' : 'Sign'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
