import { Check, File as ActionFile, GitPullRequest, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BranchesSubNav } from '../components/BranchesSubNav'
import { CommitList } from '../components/CommitList'
import { MergeRequestSignPanel } from '../components/MergeRequestSignPanel'
import { StateBlock } from '../components/StateBlock'
import { usePrincipalProfiles } from '../components/CommitEmail'
import { UserRef } from '../components/UserRef'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthMe } from '../lib/auth'
import {
  getMergeRequest,
  isSelfSignBlocked,
  mergeRefusalMessage,
  mergeRequestTitle,
  rejectMergeRequest,
} from '../lib/mergeRequests'
import { compareCommits, compareEntries, compareFile } from '../lib/oxen/api'
import { askReason } from '../lib/reasonPrompt'
import { formatRelativeTime } from '../lib/time'

/**
 * GxP #92 — merge-request view: title/description, commits, diffs, and signing.
 */
export function MergeRequestPage() {
  const { namespace = '', repo = '', mergeRequestId = '' } = useParams()
  const navigate = useNavigate()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const titleId = useId()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const mrState = useAsync(
    (signal) => getMergeRequest(mergeRequestId, signal),
    [mergeRequestId],
  )
  const me = useAsync((signal) => fetchAuthMe(signal), [])

  const source =
    mrState.kind === 'ok' ? mrState.data.sourceBranch : ''
  const target =
    mrState.kind === 'ok' ? mrState.data.targetBranch : ''
  const canCompare = Boolean(source && target && source !== target)

  const commits = useAsync(
    (signal) =>
      canCompare
        ? compareCommits(namespace, repo, target, source, signal)
        : Promise.resolve(null),
    [namespace, repo, source, target, canCompare],
  )

  const selfSignBlocked = useMemo(() => {
    if (mrState.kind !== 'ok') return false
    const signer =
      me.kind === 'ok' && me.data.authenticated ? me.data.user : null
    const commitAuthors =
      commits.kind === 'ok' && commits.data
        ? commits.data.compare.commits.map((c) => c.author).filter(Boolean)
        : []
    return isSelfSignBlocked({
      signer,
      openedBy: mrState.data.openedBy,
      commitAuthors,
    })
  }, [mrState, me, commits])

  const openerProfiles = usePrincipalProfiles(
    mrState.kind === 'ok' ? [mrState.data.openedBy] : [],
  )

  const entries = useAsync(
    (signal) =>
      canCompare
        ? compareEntries(namespace, repo, target, source, signal)
        : Promise.resolve(null),
    [namespace, repo, source, target, canCompare],
  )

  const fileDiff = useAsync(
    (signal) =>
      selectedFile && canCompare
        ? compareFile(namespace, repo, target, source, selectedFile, signal)
        : Promise.resolve(null),
    [namespace, repo, source, target, selectedFile, canCompare],
  )

  const compareHref =
    canCompare
      ? `${base}/compare?base=${encodeURIComponent(target)}&head=${encodeURIComponent(source)}`
      : `${base}/compare`

  async function onReject() {
    if (mrState.kind !== 'ok') return
    setActionError(null)
    setBusy(true)
    try {
      const path = `/auth/merge-requests/${encodeURIComponent(mergeRequestId)}/reject`
      const ceremony = await askReason({
        changeSummary: `Reject merge request ${mergeRequestTitle(mrState.data)} on ${namespace}/${repo}`,
        detail: 'An electronic signature is required to reject this merge request',
        method: 'POST',
        path,
        body: {},
      })
      if (!ceremony?.signatureId) return
      await rejectMergeRequest(mergeRequestId, {
        reason: ceremony.reason,
        category: ceremony.category,
        signatureId: ceremony.signatureId,
        changeControlId: ceremony.changeControlId,
      })
      navigate(`${base}/merge-requests`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page wide">
      <BranchesSubNav />
      <div className="page-head">
        <div>
          <h1 id={titleId}>
            <GitPullRequest
              size={20}
              aria-hidden="true"
              className="button-label-icon"
            />
            {mrState.kind === 'ok'
              ? mergeRequestTitle(mrState.data)
              : 'Request'}
          </h1>
          {mrState.kind === 'ok' ? (
            <p className="lede mr-view-lede">
              <span className="mono">{mrState.data.sourceBranch}</span>
              {' → '}
              <span className="mono">{mrState.data.targetBranch}</span>
              {' · '}
              <span className={`ns-tag ${mrState.data.status === 'open' ? 'ns-tag-accent' : 'ns-tag-muted'}`}>
                {mrState.data.status}
              </span>
              {' · '}
              <time
                dateTime={mrState.data.createdAt}
                title={new Date(mrState.data.createdAt).toLocaleString()}
              >
                {formatRelativeTime(mrState.data.createdAt)}
              </time>
              {' · Opened by '}
              <UserRef
                author={mrState.data.openedBy}
                profiles={openerProfiles}
              />
            </p>
          ) : (
            <p className="lede">
              Review commits and differences, then sign to merge into the validated
              branch.
            </p>
          )}
        </div>
        <div className="btn-row">
          <Link className="btn ghost" to={`${base}/merge-requests`}>
            All requests
          </Link>
          {canCompare ? (
            <Link className="btn ghost" to={compareHref}>
              Full compare
            </Link>
          ) : null}
        </div>
      </div>

      <StateBlock
        loading={mrState.kind === 'loading'}
        error={mrState.kind === 'error' ? mrState.message : null}
        onRetry={() => mrState.reload()}
      >
        {mrState.kind === 'ok' ? (
          <>
            <section className="panel mr-view-summary">
              <h2 className="section-label">Description</h2>
              {mrState.data.description.trim() ? (
                <p className="mr-view-description">{mrState.data.description.trim()}</p>
              ) : (
                <p className="muted">No description provided.</p>
              )}
              <p className="muted small mono mr-view-id">{mrState.data.id}</p>
              <div className="mr-row-heads" aria-label="Pinned commit heads">
                <span className="mr-head">
                  <span className="mr-head-label">From {mrState.data.sourceBranch}</span>
                  <span
                    className="commit-sha mono"
                    title={mrState.data.expectedSourceHead}
                  >
                    {mrState.data.expectedSourceHead.slice(0, 8)}
                  </span>
                </span>
                <span className="mr-head">
                  <span className="mr-head-label">Into {mrState.data.targetBranch}</span>
                  <span
                    className="commit-sha mono"
                    title={mrState.data.expectedTargetHead}
                  >
                    {mrState.data.expectedTargetHead.slice(0, 8)}
                  </span>
                </span>
              </div>
            </section>

            <section className="panel">
              <div className="section-label-row">
                <h2 className="section-label">Commits</h2>
                <span className="muted small">
                  {commits.kind === 'ok' && commits.data
                    ? `${commits.data.compare.commits.length} in range`
                    : null}
                </span>
              </div>
              <StateBlock
                loading={commits.kind === 'loading'}
                error={commits.kind === 'error' ? commits.message : null}
              >
                {commits.kind === 'ok' && commits.data ? (
                  commits.data.compare.commits.length === 0 ? (
                    <p className="muted">No commits in this range.</p>
                  ) : (
                    <CommitList
                      namespace={namespace}
                      repo={repo}
                      commits={commits.data.compare.commits}
                    />
                  )
                ) : null}
              </StateBlock>
            </section>

            <section className="panel">
              <div className="section-label-row">
                <h2 className="section-label">Differences</h2>
                <span className="muted small">
                  {entries.kind === 'ok' && entries.data
                    ? `+${entries.data.compare.counts.added} / −${entries.data.compare.counts.removed} / ~${entries.data.compare.counts.modified}`
                    : null}
                </span>
              </div>
              <StateBlock
                loading={entries.kind === 'loading'}
                error={entries.kind === 'error' ? entries.message : null}
              >
                {entries.kind === 'ok' && entries.data ? (
                  entries.data.compare.entries.length === 0 ? (
                    <p className="muted">No file changes in this range.</p>
                  ) : (
                    <table className="file-table">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Path</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.data.compare.entries.map((entry) => (
                          <tr
                            key={entry.filename}
                            className={
                              selectedFile === entry.filename ? 'selected' : ''
                            }
                          >
                            <td>
                              <span className={`pill ${entry.status}`}>
                                {entry.status}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="linkish"
                                onClick={() => setSelectedFile(entry.filename)}
                              >
                                <ActionFile
                                  size={14}
                                  aria-hidden="true"
                                  className="button-label-icon"
                                />
                                {entry.filename}
                              </button>
                            </td>
                            <td className="muted">{entry.data_type ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                ) : null}
              </StateBlock>

              <h3 className="section-label">File diff</h3>
              {!selectedFile ? (
                <p className="muted">Select a file to view its diff.</p>
              ) : (
                <StateBlock
                  loading={fileDiff.kind === 'loading'}
                  error={fileDiff.kind === 'error' ? fileDiff.message : null}
                >
                  {fileDiff.kind === 'ok' && fileDiff.data ? (
                    <>
                      <p className="muted small">
                        {fileDiff.data.compare.filename} ·{' '}
                        {fileDiff.data.compare.status}
                      </p>
                      {fileDiff.data.compare.diff?.lines ? (
                        <pre className="code-preview diff-preview">
                          {fileDiff.data.compare.diff.lines.map((line, i) => (
                            <div
                              key={`${i}-${line.modification}`}
                              className={`diff-line diff-${line.modification}`}
                            >
                              {line.text}
                            </div>
                          ))}
                        </pre>
                      ) : (
                        <p className="muted">No textual diff for this file.</p>
                      )}
                    </>
                  ) : null}
                </StateBlock>
              )}
            </section>

            {(mrState.data.status === 'open' ||
              mrState.data.status === 'stale') && (
              <div className="mr-view-actions">
                {actionError ? (
                  <p className="error" role="alert">
                    {actionError}
                  </p>
                ) : null}
                {selfSignBlocked ? (
                  <p className="muted small" role="status">
                    {mergeRefusalMessage(
                      'self_merge',
                      'Self-merge forbidden (4-eyes principle)',
                    )}
                  </p>
                ) : null}
                <div className="btn-row">
                  <button
                    type="button"
                    className={
                      selfSignBlocked
                        ? 'btn primary is-disabled'
                        : 'btn primary'
                    }
                    disabled={busy || selfSignBlocked}
                    aria-disabled={selfSignBlocked || undefined}
                    title={
                      selfSignBlocked
                        ? mergeRefusalMessage(
                            'self_merge',
                            'Self-merge forbidden (4-eyes principle)',
                          )
                        : undefined
                    }
                    onClick={() => {
                      if (selfSignBlocked) return
                      setSigning(true)
                    }}
                  >
                    <Check size={14} aria-hidden="true" className="button-label-icon" />
                    Sign
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => void onReject()}
                  >
                    <X size={14} aria-hidden="true" className="button-label-icon" />
                    Reject
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </StateBlock>

      {signing ? (
        <MergeRequestSignPanel
          mergeRequestId={mergeRequestId}
          namespace={namespace}
          repo={repo}
          embedded
          onDismiss={() => setSigning(false)}
          onComplete={() => {
            setSigning(false)
            mrState.reload()
          }}
        />
      ) : null}
    </main>
  )
}
