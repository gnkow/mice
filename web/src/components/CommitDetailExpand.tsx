import { Copy as ActionCopy, FolderOpen as ActionFolderOpen } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { fetchCoveringSignature } from '../lib/authzApi'
import { qcStatusPillLabel, type CommitQcStatus } from '../lib/commitQc'
import { fetchCommitDisposition } from '../lib/dispositionApi'
import { compareEntries, listDirectory } from '../lib/oxen/api'
import type { Commit, DiffEntry, DiffEntryStatus } from '../lib/oxen/types'
import { formatRelativeTime } from '../lib/time'
import { CommitDispositionPanel } from './CommitDispositionPanel'
import { MetaBody } from './MetaPanel'
import { RevokeSignatureButton } from './RevokeSignatureButton'
import { SignedRecordReportButton } from './SignedRecordReportButton'
import { UserRef } from './UserRef'

type TabId = 'details' | 'qc' | 'metadata'

type ChangedFile = {
  path: string
  status: DiffEntryStatus
  dataType?: string
  isDir?: boolean
}

type Props = {
  namespace: string
  repo: string
  commit: Commit
  /** List-row QC (may be stale vs disposition fetch). */
  listQc?: CommitQcStatus
  descendsFromInvalid?: boolean
  canWrite?: boolean
  canRevoke?: boolean
  canViewSignedRecord?: boolean
  signer?: { iss: string; sub: string } | null
  linkSearch?: string
  onQcChanged?: () => void
}

function entryToChanged(entry: DiffEntry): ChangedFile {
  return {
    path: entry.filename.replace(/^\/+/, ''),
    status: entry.status,
    dataType: entry.data_type,
    isDir: entry.is_dir === true,
  }
}

/**
 * Inline expand panel under a history row.
 * Tabs: Details (facts + files), Quality Control, Metadata; shared actions at bottom.
 */
export function CommitDetailExpand({
  namespace,
  repo,
  commit,
  listQc,
  descendsFromInvalid = false,
  canWrite = false,
  canRevoke = false,
  canViewSignedRecord = false,
  signer = null,
  linkSearch = '',
  onQcChanged,
}: Props) {
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const tabsId = useId()
  const [tab, setTab] = useState<TabId>('details')
  const [hashCopied, setHashCopied] = useState(false)
  const parentId = commit.parent_ids[0]

  async function copyCommitId() {
    try {
      await navigator.clipboard.writeText(commit.id)
      setHashCopied(true)
      window.setTimeout(() => setHashCopied(false), 1500)
    } catch {
      setHashCopied(false)
    }
  }

  const dispositionDetail = useAsync(
    (signal) => fetchCommitDisposition(namespace, repo, commit.id, signal),
    [namespace, repo, commit.id],
  )
  const covering = useAsync(
    (signal) =>
      canRevoke
        ? fetchCoveringSignature(namespace, repo, commit.id, signal)
        : Promise.resolve(null),
    [namespace, repo, commit.id, canRevoke],
  )
  const changedFiles = useAsync(
    async (signal): Promise<ChangedFile[]> => {
      try {
        if (parentId) {
          const cmp = await compareEntries(
            namespace,
            repo,
            parentId,
            commit.id,
            signal,
          )
          return (cmp.compare.entries ?? []).map(entryToChanged)
        }
        // Root commit: no parent to diff against — list the tree tip as added.
        const dir = await listDirectory(namespace, repo, commit.id, '', signal)
        return (dir.entries ?? [])
          .map((e) => ({
            path: e.filename.replace(/^\/+/, ''),
            status: 'added' as const,
            dataType: e.data_type,
            isDir: e.is_dir,
          }))
          .filter((f) => f.path)
      } catch (err) {
        if (signal.aborted) throw err
        return []
      }
    },
    [namespace, repo, commit.id, parentId],
  )

  const historyRows =
    dispositionDetail.kind === 'ok' ? dispositionDetail.data?.history ?? [] : []
  const disposedBy = historyRows[0]?.actorKey ?? null
  const detailQc =
    dispositionDetail.kind === 'ok' && dispositionDetail.data
      ? dispositionDetail.data.status
      : listQc
  const absoluteTime = new Date(commit.timestamp).toLocaleString()
  const messageLines = (commit.message || '').split('\n')
  const messageSubject = messageLines[0]?.trim() || '(no message)'
  const messageBody = messageLines.slice(1).join('\n').trim()
  const fileCount =
    changedFiles.kind === 'ok' ? changedFiles.data.length : null

  function refresh() {
    dispositionDetail.reload()
    covering.reload()
    onQcChanged?.()
  }

  function fileHref(file: ChangedFile): string {
    const rev =
      file.status === 'removed' && parentId ? parentId : commit.id
    const encodedPath = file.path
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/')
    if (file.isDir) {
      return `${base}/tree/${encodeURIComponent(rev)}/${encodedPath}`
    }
    return `${base}/blob/${encodeURIComponent(rev)}/${encodedPath}`
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'qc', label: 'Quality Control' },
    { id: 'metadata', label: 'Metadata' },
  ]

  return (
    <div
      className="commit-detail-expand"
      id={`commit-detail-${commit.id}`}
      role="region"
      aria-label="Commit detail"
      data-testid="commit-detail-expand"
    >
      <div className="tab-bar" role="tablist" aria-label="Commit detail sections">
        {tabs.map((t) => {
          const selected = tab === t.id
          const panelId = `${tabsId}-${t.id}`
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'active' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div
        className="commit-detail-expand-panel"
        role="tabpanel"
        id={`${tabsId}-${tab}`}
        aria-labelledby={`${tabsId}-tab-${tab}`}
      >
        {tab === 'details' ? (
          <div className="commit-detail-details-tab">
            <header className="commit-detail-message">
              <h3 className="commit-detail-message-subject">{messageSubject}</h3>
              {messageBody ? (
                <pre className="commit-detail-message-body">{messageBody}</pre>
              ) : null}
            </header>

            <dl className="commit-detail-expand-facts">
              <div className="commit-detail-fact-wide">
                <dt>Commit</dt>
                <dd>
                  <div className="commit-detail-copy-row">
                    <code className="mono" title={commit.id}>
                      {commit.id}
                    </code>
                    <button
                      type="button"
                      className="settings-copy-btn"
                      onClick={() => void copyCommitId()}
                      aria-label="Copy commit hash"
                      data-testid="commit-detail-copy-hash"
                    >
                      <ActionCopy size={12} aria-hidden="true" />
                      <span aria-live="polite">{hashCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </dd>
              </div>
              <div>
                <dt>Author</dt>
                <dd>
                  <UserRef
                    author={commit.author}
                    storedEmail={commit.email}
                    interactive={false}
                  />
                </dd>
              </div>
              <div>
                <dt>Committed</dt>
                <dd>
                  <time dateTime={commit.timestamp} title={absoluteTime}>
                    {formatRelativeTime(commit.timestamp)}
                  </time>
                  <div className="muted small">{absoluteTime}</div>
                </dd>
              </div>
              <div>
                <dt>Parents</dt>
                <dd>
                  {commit.parent_ids.length === 0 ? (
                    <span className="muted">none (root)</span>
                  ) : (
                    <span className="history-parent-links">
                      {commit.parent_ids.map((id) => (
                        <Link
                          key={id}
                          className="mono"
                          to={`${base}/commits/${encodeURIComponent(id)}${linkSearch}`}
                          title={id}
                        >
                          {id.slice(0, 8)}
                        </Link>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            <div
              className="commit-detail-changed-files"
              data-testid="commit-detail-changed-files"
            >
              <h3 className="section-label">
                {parentId ? 'Changed files' : 'Files in commit'}
                {fileCount != null && fileCount > 0 ? (
                  <span className="muted"> · {fileCount}</span>
                ) : null}
              </h3>
              {changedFiles.kind === 'loading' ? (
                <p className="muted small" role="status">
                  Loading files…
                </p>
              ) : changedFiles.kind === 'error' ||
                (changedFiles.kind === 'ok' && changedFiles.data.length === 0) ? (
                <div className="commit-detail-files-empty">
                  <p className="muted small">
                    {changedFiles.kind === 'error'
                      ? 'Could not load the file list for this commit.'
                      : parentId
                        ? 'No files changed in this commit.'
                        : 'Open the tree to browse files introduced by this root commit.'}
                  </p>
                  <Link className="btn ghost small" to={`${base}/tree/${commit.id}`}>
                    <ActionFolderOpen
                      size={14}
                      aria-hidden="true"
                      className="button-label-icon"
                    />
                    Browse files
                  </Link>
                </div>
              ) : (
                <>
                  <ul className="commit-detail-file-list">
                    {changedFiles.data.map((file) => (
                      <li key={`${file.status}:${file.path}`}>
                        <span className={`pill ${file.status}`}>{file.status}</span>
                        <Link
                          className="file-name-link"
                          to={fileHref(file)}
                          title={file.path}
                        >
                          {file.path}
                        </Link>
                        {file.dataType ? (
                          <span className="muted small">{file.dataType}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <div className="commit-detail-tab-actions is-end">
                    <Link className="btn ghost small" to={`${base}/tree/${commit.id}`}>
                      <ActionFolderOpen
                        size={14}
                        aria-hidden="true"
                        className="button-label-icon"
                      />
                      Browse
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'qc' ? (
          <div
            className="commit-detail-disposition-tab"
            data-testid="commit-detail-qc-status"
          >
            <div className="commit-detail-expand-disposition">
              <span
                className={
                  detailQc === 'valid'
                    ? 'ns-tag ns-tag-accent'
                    : detailQc === 'invalid'
                      ? 'ns-tag ns-tag-warn'
                      : 'ns-tag ns-tag-muted'
                }
              >
                {qcStatusPillLabel(detailQc)}
              </span>
              {disposedBy ? (
                <span className="muted small">
                  by <UserRef author={disposedBy} interactive={false} />
                  {historyRows[0] ? (
                    <>
                      {' '}
                      ·{' '}
                      <time
                        dateTime={historyRows[0].at}
                        title={new Date(historyRows[0].at).toLocaleString()}
                      >
                        {formatRelativeTime(historyRows[0].at)}
                      </time>
                    </>
                  ) : null}
                </span>
              ) : detailQc === 'unset' || !detailQc ? (
                <span className="muted small">No signed disposition yet</span>
              ) : null}
            </div>

            {detailQc === 'invalid' ? (
              <p
                className="flash flash-warn qc-invalid-warning"
                role="status"
                data-testid="commit-detail-qc-invalid"
              >
                This commit is <strong>Invalid</strong>. Pins and jobs may still
                use it; review before regulated release.
              </p>
            ) : descendsFromInvalid ? (
              <p
                className="flash flash-warn qc-invalid-warning"
                role="status"
                data-testid="commit-detail-qc-descendant"
              >
                This commit descends from an <strong>Invalid</strong> commit.
              </p>
            ) : null}

            {historyRows.length > 0 ? (
              <ul
                className="disposition-history-list"
                data-testid="disposition-history-list"
              >
                {historyRows.map((row) => (
                  <li key={row.id} className="disposition-history-row">
                    <span
                      className={
                        row.status === 'valid'
                          ? 'ns-tag ns-tag-accent'
                          : 'ns-tag ns-tag-warn'
                      }
                    >
                      {row.status === 'valid' ? 'Valid' : 'Invalid'}
                    </span>
                    <UserRef author={row.actorKey} interactive={false} />
                    <time
                      className="muted small"
                      dateTime={row.at}
                      title={new Date(row.at).toLocaleString()}
                    >
                      {formatRelativeTime(row.at)}
                    </time>
                    <span className="mono small muted" title={row.signatureId}>
                      {row.signatureId.slice(0, 8)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : dispositionDetail.kind === 'loading' ? (
              <p className="muted small" role="status">
                Loading history…
              </p>
            ) : (
              <p className="muted small" data-testid="disposition-history-empty">
                No signed dispositions yet.
              </p>
            )}

            {canViewSignedRecord ||
            canWrite ||
            (canRevoke &&
              covering.kind === 'ok' &&
              covering.data?.signature &&
              !covering.data.signature.revoked &&
              detailQc !== 'invalid') ? (
              <div className="commit-detail-tab-actions is-end">
                {canViewSignedRecord ? (
                  <SignedRecordReportButton
                    namespace={namespace}
                    repo={repo}
                    className="btn ghost small"
                    compact
                  />
                ) : null}
                {canWrite ? (
                  <CommitDispositionPanel
                    namespace={namespace}
                    repo={repo}
                    commitId={commit.id}
                    author={commit.author}
                    authorEmail={commit.email}
                    currentQc={detailQc}
                    signer={signer}
                    onDone={refresh}
                  />
                ) : null}
                {canRevoke &&
                covering.kind === 'ok' &&
                covering.data?.signature &&
                !covering.data.signature.revoked &&
                detailQc !== 'invalid' ? (
                  <RevokeSignatureButton
                    signatureId={covering.data.signature.signatureId}
                    namespace={namespace}
                    repo={repo}
                    commitIds={[commit.id]}
                    onRevoked={refresh}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'metadata' ? (
          <div className="commit-detail-meta-tab">
            <MetaBody type="commit" id={`${namespace}/${repo}#${commit.id}`} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
