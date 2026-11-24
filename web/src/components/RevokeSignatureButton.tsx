import { Eye, ShieldOff as ActionShieldOff } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { revokeSignature } from '../lib/authzApi'
import { isCeremonyCancelled } from '../lib/ceremonyCancelled'
import { getCommit } from '../lib/oxen/api'
import type { Commit } from '../lib/oxen/types'
import { revokeFailureMessage } from '../lib/signatureRevoke'
import { formatRelativeTime } from '../lib/time'
import { Modal } from './Modal'
import { UserRef } from './UserRef'

export type RevokeCandidateCommit = {
  id: string
  /** Short role label, e.g. Incoming tip / Merge commit (never the target tip). */
  role?: string
}

type Props = {
  signatureId: string
  namespace?: string
  repo?: string
  /**
   * When set, revoke only these commits (pre-selected; no whole-signature option).
   * Used from validated-branch history for a single commit (#93).
   */
  commitIds?: string[]
  /** Merged MR id — whole-signature revoke resolves incoming range + merge commit (#94). */
  mergeRequestId?: string
  /** Known commits covered by this signature (checkboxes in the modal). */
  candidateCommits?: RevokeCandidateCommit[]
  /** @deprecated Prefer candidateCommits — kept for callers that only have ids. */
  candidateCommitIds?: string[]
  /** Called after the revoke succeeded so the caller can refresh its list. */
  onRevoked?: () => void
}

type Scope = 'whole' | 'selected'

function shortSha(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function firstLine(message: string): string {
  const line = message.trim().split(/\r?\n/)[0] ?? ''
  return line.length > 72 ? `${line.slice(0, 72)}…` : line
}

/**
 * Revokes a signature (GxP #93). Opens a modal to choose whole signature vs
 * selected commits, then Confirm runs `authzFetch` → `withReason` (ceremony).
 */
export function RevokeSignatureButton({
  signatureId,
  namespace = '',
  repo = '',
  commitIds: lockedCommitIds,
  mergeRequestId,
  candidateCommits,
  candidateCommitIds,
  onRevoked,
}: Props) {
  const errorId = useId()
  const scopeWholeId = useId()
  const scopeSelectedId = useId()
  const locked = Boolean(lockedCommitIds && lockedCommitIds.length > 0)
  const candidates = useMemo((): RevokeCandidateCommit[] => {
    if (locked) {
      return lockedCommitIds!.map((id) => ({ id: id.trim() })).filter((c) => c.id)
    }
    if (candidateCommits && candidateCommits.length > 0) {
      const seen = new Set<string>()
      const out: RevokeCandidateCommit[] = []
      for (const c of candidateCommits) {
        const id = c.id.trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push({ id, role: c.role })
      }
      return out
    }
    return [...new Set((candidateCommitIds ?? []).map((id) => id.trim()).filter(Boolean))].map(
      (id) => ({ id }),
    )
  }, [locked, lockedCommitIds, candidateCommits, candidateCommitIds])

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>(locked ? 'selected' : 'whole')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(locked ? candidates.map((c) => c.id) : []),
  )
  const [details, setDetails] = useState<Record<string, Commit | null>>({})
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [inspectId, setInspectId] = useState<string | null>(null)
  const [done, setDone] = useState<{ blocked: number } | null>(null)
  const submitting = useRef(false)

  useEffect(() => {
    if (!open || !namespace || !repo || candidates.length === 0) return
    const controller = new AbortController()
    setDetailsLoading(true)
    void Promise.all(
      candidates.map(async (c) => {
        try {
          const res = await getCommit(namespace, repo, c.id, controller.signal)
          return [c.id, res.commit] as const
        } catch {
          return [c.id, null] as const
        }
      }),
    ).then((rows) => {
      if (controller.signal.aborted) return
      const next: Record<string, Commit | null> = {}
      for (const [id, commit] of rows) next[id] = commit
      setDetails(next)
      setDetailsLoading(false)
    })
    return () => controller.abort()
  }, [open, namespace, repo, candidates])

  function openModal() {
    setError(null)
    setScope(locked ? 'selected' : 'whole')
    setSelected(new Set(locked ? candidates.map((c) => c.id) : []))
    setInspectId(null)
    setOpen(true)
  }

  function closeModal() {
    if (busy) return
    setOpen(false)
    setInspectId(null)
    setError(null)
  }

  function toggleCommit(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectedCommitIds(): string[] | undefined {
    if (locked) {
      return [...new Set(lockedCommitIds!.map((id) => id.trim()).filter(Boolean))]
    }
    if (scope === 'whole') return undefined
    const ids = [...selected]
    return ids.length > 0 ? ids : undefined
  }

  const canConfirm =
    locked ||
    scope === 'whole' ||
    selected.size > 0

  async function onConfirm() {
    if (!canConfirm || submitting.current) return
    submitting.current = true
    const commitIds = selectedCommitIds()
    // Close selection modal first so the signing ceremony is the only dialog.
    setOpen(false)
    setInspectId(null)
    setBusy(true)
    setError(null)
    try {
      const body: { commitIds?: string[]; mergeRequestId?: string } = {}
      if (commitIds && commitIds.length > 0) body.commitIds = commitIds
      if (mergeRequestId) body.mergeRequestId = mergeRequestId
      const res = await revokeSignature(
        signatureId,
        Object.keys(body).length > 0 ? body : undefined,
      )
      setDone({ blocked: res.blockedMergeRequestIds.length })
      onRevoked?.()
    } catch (err) {
      if (!isCeremonyCancelled(err)) {
        setError(revokeFailureMessage(err))
        setOpen(true)
      }
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  function renderCommitMeta(id: string, role?: string) {
    const commit = details[id]
    return (
      <span className="signature-revoke-commit-meta">
        <span className="signature-revoke-commit-head">
          <span className="mono small" title={id}>
            {shortSha(id)}
          </span>
          {role ? <span className="ns-tag ns-tag-muted">{role}</span> : null}
        </span>
        {commit ? (
          <>
            <span className="signature-revoke-commit-message">
              {firstLine(commit.message) || '(no message)'}
            </span>
            <span className="muted small signature-revoke-commit-author">
              <UserRef
                author={commit.author || commit.email || 'Unknown'}
                storedEmail={commit.email}
                interactive={false}
              />
              {' · '}
              <time
                dateTime={commit.timestamp}
                title={new Date(commit.timestamp).toLocaleString()}
              >
                {formatRelativeTime(commit.timestamp)}
              </time>
            </span>
          </>
        ) : detailsLoading ? (
          <span className="muted small">Loading…</span>
        ) : (
          <span className="muted small mono" title={id}>
            {id}
          </span>
        )}
      </span>
    )
  }

  function renderCommitRow(c: RevokeCandidateCommit, opts: { selectable: boolean }) {
    const inputId = `revoke-commit-${signatureId}-${c.id}`
    return (
      <li key={c.id} className="signature-revoke-commit-row">
        <div className="signature-revoke-commit-main">
          {opts.selectable ? (
            <label className="signature-revoke-option" htmlFor={inputId}>
              <input
                id={inputId}
                type="checkbox"
                checked={selected.has(c.id)}
                disabled={busy}
                onChange={() => toggleCommit(c.id)}
              />
              {renderCommitMeta(c.id, c.role)}
            </label>
          ) : (
            renderCommitMeta(c.id, c.role)
          )}
        </div>
        <button
          type="button"
          className="btn ghost small"
          disabled={busy}
          aria-label={`View commit ${shortSha(c.id)}`}
          data-testid="signature-revoke-commit-view"
          onClick={() => setInspectId(c.id)}
        >
          <Eye size={12} aria-hidden="true" className="button-label-icon" />
          View
        </button>
      </li>
    )
  }

  const inspectCommit = inspectId ? details[inspectId] : null
  const inspectRole = inspectId
    ? candidates.find((c) => c.id === inspectId)?.role
    : undefined
  const historyHref =
    namespace && repo && inspectId
      ? `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/commits/${encodeURIComponent(inspectId)}`
      : null
  const treeHref =
    namespace && repo && inspectId
      ? `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/tree/${encodeURIComponent(inspectId)}`
      : null

  if (done) {
    return (
      <p className="flash flash-success small" role="status" data-testid="signature-revoked">
        {locked
          ? 'Commit marked QC Failed'
          : 'Signature revoked. Affected commits are now QC Failed'}
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
        aria-label={locked ? 'Revoke commit' : 'Revoke signature'}
        onClick={openModal}
        data-testid="signature-revoke-button"
      >
        <ActionShieldOff size={12} aria-hidden="true" className="button-label-icon" />
        Revoke
      </button>

      {open ? (
        <Modal
          title={locked ? 'Revoke commit' : 'Revoke signature'}
          onClose={closeModal}
        >
          <div className="signature-revoke-modal" data-testid="signature-revoke-modal">
            <p className="muted small">
              Signature <span className="mono">{shortSha(signatureId)}</span>
              {locked
                ? ' — revoke only the selected commit (others stay unchanged).'
                : ' — whole signature, or only incoming / merge commits (not the pre-merge target tip). Confirm opens the signing ceremony.'}
            </p>

            {locked ? (
              <ul
                className="signature-revoke-commit-list"
                data-testid="signature-revoke-locked-commits"
              >
                {candidates.map((c) => renderCommitRow(c, { selectable: false }))}
              </ul>
            ) : (
              <fieldset className="signature-revoke-scope">
                <legend className="visually-hidden">Revoke scope</legend>
                <label className="signature-revoke-option" htmlFor={scopeWholeId}>
                  <input
                    id={scopeWholeId}
                    type="radio"
                    name={`revoke-scope-${signatureId}`}
                    checked={scope === 'whole'}
                    disabled={busy}
                    onChange={() => setScope('whole')}
                    data-testid="signature-revoke-scope-whole"
                  />
                  <span>
                    Whole signature
                    <span className="muted small"> — all covered commits become QC Failed</span>
                  </span>
                </label>
                <label className="signature-revoke-option" htmlFor={scopeSelectedId}>
                  <input
                    id={scopeSelectedId}
                    type="radio"
                    name={`revoke-scope-${signatureId}`}
                    checked={scope === 'selected'}
                    disabled={busy || candidates.length === 0}
                    onChange={() => setScope('selected')}
                    data-testid="signature-revoke-scope-selected"
                  />
                  <span>
                    Selected commits
                    <span className="muted small"> — only checked commits</span>
                  </span>
                </label>
              </fieldset>
            )}

            {!locked && scope === 'selected' ? (
              <div className="signature-revoke-select" data-testid="signature-revoke-select">
                {candidates.length > 0 ? (
                  <ul className="signature-revoke-commit-list">
                    {candidates.map((c) => renderCommitRow(c, { selectable: true }))}
                  </ul>
                ) : (
                  <p className="muted small" role="status">
                    No known commits for this signature — use whole signature instead.
                  </p>
                )}
              </div>
            ) : null}

            {error ? (
              <p id={errorId} className="flash flash-error small" role="alert">
                {error}
              </p>
            ) : null}

            <div className="modal-actions btn-row">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={busy || !canConfirm}
                aria-label={busy ? 'Revoking' : 'Confirm revoke'}
                aria-describedby={error ? errorId : undefined}
                onClick={() => void onConfirm()}
                data-testid="signature-revoke-confirm"
              >
                <ActionShieldOff size={14} aria-hidden="true" className="button-label-icon" />
                {busy ? 'Revoking…' : 'Confirm revoke'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {open && inspectId ? (
        <Modal title="Commit" onClose={() => setInspectId(null)}>
          <div className="signature-revoke-commit-detail" data-testid="signature-revoke-commit-detail">
            <dl className="repo-signature-detail-grid">
              <div>
                <dt>Id</dt>
                <dd className="mono small">{inspectId}</dd>
              </div>
              {inspectRole ? (
                <div>
                  <dt>Role</dt>
                  <dd>{inspectRole}</dd>
                </div>
              ) : null}
              {inspectCommit ? (
                <>
                  <div>
                    <dt>Message</dt>
                    <dd>{inspectCommit.message || '(no message)'}</dd>
                  </div>
                  <div>
                    <dt>Author</dt>
                    <dd>
                      <UserRef
                        author={inspectCommit.author || inspectCommit.email || 'Unknown'}
                        storedEmail={inspectCommit.email}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Signed time</dt>
                    <dd>
                      <time dateTime={inspectCommit.timestamp}>
                        {new Date(inspectCommit.timestamp).toLocaleString()}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>Parents</dt>
                    <dd className="mono small">
                      {inspectCommit.parent_ids.length === 0
                        ? '—'
                        : inspectCommit.parent_ids.join(', ')}
                    </dd>
                  </div>
                </>
              ) : detailsLoading ? (
                <div>
                  <dt>Details</dt>
                  <dd className="muted">Loading…</dd>
                </div>
              ) : (
                <div>
                  <dt>Details</dt>
                  <dd className="muted">Could not load this commit.</dd>
                </div>
              )}
            </dl>
            <div className="modal-actions btn-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setInspectId(null)}
              >
                Back
              </button>
              {historyHref ? (
                <Link className="btn ghost" to={historyHref} onClick={closeModal}>
                  Open in History
                </Link>
              ) : null}
              {treeHref ? (
                <Link className="btn" to={treeHref} onClick={closeModal}>
                  Browse tree
                </Link>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
