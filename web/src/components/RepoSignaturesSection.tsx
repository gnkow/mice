import { Eye, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useAsync } from '../hooks/useAsync'
import { fetchRepoSignatures, type RepoSignatureRow } from '../lib/authzApi'
import { formatRelativeTime } from '../lib/time'
import { Modal } from './Modal'
import { Pagination, paginate } from './Pagination'
import { RevokeSignatureButton } from './RevokeSignatureButton'
import { SignedRecordReportButton } from './SignedRecordReportButton'
import { StateBlock } from './StateBlock'
import { UserRef } from './UserRef'

/** Compact page — each row carries revoke chrome. */
const SIGNATURE_PAGE_SIZE = 5

type Props = {
  namespace: string
  repo: string
  /** Approver seat — only Approvers may revoke; Auditors observe via Audit. */
  canRevoke: boolean
}

function shortSha(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function signatureMatches(row: RepoSignatureRow, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return true
  const parts = [
    row.id,
    row.meaning,
    row.signer.name,
    row.signer.sub,
    row.signer.iss,
    row.changeControlId,
    row.binding?.sourceHead,
    row.binding?.targetHead,
    row.binding?.repo,
    row.binding?.manifestDigest,
    row.revoked ? 'revoked' : '',
  ]
  return parts.some((p) => (p ?? '').toLowerCase().includes(q))
}

/** Commits that entered the validated branch — never the pre-merge target tip. */
function revocableCommitsFromBinding(
  binding: NonNullable<RepoSignatureRow['binding']>,
) {
  return [{ id: binding.sourceHead, role: 'Incoming tip' }]
}

/**
 * Repo signatures for Approver revoke (#93). Readers can list; revoke requires Approver.
 * Auditor is a separate role and does not use this control.
 */
export function RepoSignaturesSection({ namespace, repo, canRevoke }: Props) {
  const searchId = useId()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const state = useAsync(
    (signal) => fetchRepoSignatures(namespace, repo, signal),
    [namespace, repo],
  )

  const signatures = state.kind === 'ok' ? state.data.signatures : []
  const filtered = useMemo(
    () => signatures.filter((row) => signatureMatches(row, query)),
    [signatures, query],
  )
  const slice = paginate(filtered, page, SIGNATURE_PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [query, namespace, repo])

  const countLabel = query.trim()
    ? `${filtered.length} of ${signatures.length} signature${signatures.length === 1 ? '' : 's'}`
    : `${signatures.length} signature${signatures.length === 1 ? '' : 's'}`

  return (
    <section
      className="settings-section"
      id="repo-signatures"
      aria-labelledby="repo-signatures-heading"
    >
      <h2 id="repo-signatures-heading">Signatures</h2>
      <p className="muted small">
        Approvals and revocations for validated-branch merges. Approvers can revoke
        here; export PDF or JSON for audit evidence.
      </p>
      <div id="repo-signed-record" className="repo-signatures-export">
        <SignedRecordReportButton
          namespace={namespace}
          repo={repo}
          className="btn small"
        />
      </div>
      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
      >
        {state.kind === 'ok' ? (
          signatures.length === 0 ? (
            <p className="muted">No signatures recorded for this repository yet.</p>
          ) : (
            <>
              <div className="repo-signature-toolbar">
                <label className="repo-signature-search" htmlFor={searchId}>
                  <Search size={14} aria-hidden="true" />
                  <span className="visually-hidden">Search signatures</span>
                  <input
                    id={searchId}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by id, signer, heads, change-control…"
                    data-testid="repo-signatures-search"
                    autoComplete="off"
                  />
                </label>
                <p className="muted small" role="status">
                  {countLabel}
                </p>
              </div>
              {filtered.length === 0 ? (
                <p className="muted small" role="status" id={listId}>
                  No signatures match “{query.trim()}”.
                </p>
              ) : (
                <>
                  <ul
                    className="repo-signature-list"
                    id={listId}
                    aria-labelledby="repo-signatures-heading"
                  >
                    {slice.items.map((row) => (
                      <SignatureRow
                        key={row.id}
                        row={row}
                        namespace={namespace}
                        repo={repo}
                        canRevoke={canRevoke}
                        onRevoked={() => state.reload()}
                      />
                    ))}
                  </ul>
                  {slice.pageCount > 1 ? (
                    <Pagination
                      page={slice.page}
                      pageCount={slice.pageCount}
                      total={slice.total}
                      onPageChange={setPage}
                      label="Signatures pagination"
                    />
                  ) : null}
                </>
              )}
            </>
          )
        ) : null}
      </StateBlock>
    </section>
  )
}

function SignatureRow({
  row,
  namespace,
  repo,
  canRevoke,
  onRevoked,
}: {
  row: RepoSignatureRow
  namespace: string
  repo: string
  canRevoke: boolean
  onRevoked: () => void
}) {
  const [viewOpen, setViewOpen] = useState(false)
  const signerAuthor = `${row.signer.iss}|${row.signer.sub}`
  const signed = new Date(row.signedAt)

  return (
    <li className="repo-signature-row" data-testid="repo-signature-row">
      <div className="repo-signature-main">
        <div className="repo-signature-meta">
          <span className="mono small" title={row.id}>
            {shortSha(row.id)}
          </span>
          <span className="ns-tag ns-tag-accent">{row.meaning}</span>
          {row.revoked ? (
            <span className="ns-tag ns-tag-warn" data-testid="signature-revoked-tag">
              Revoked
            </span>
          ) : null}
          {row.changeControlId ? (
            <span className="mono small muted" title="Change-control id">
              {row.changeControlId}
            </span>
          ) : null}
        </div>
        <p className="repo-signature-summary muted small">
          <UserRef
            author={signerAuthor}
            name={row.signer.name}
            interactive={false}
          />
          <span className="repo-signature-sep" aria-hidden="true">
            ·
          </span>
          <time dateTime={row.signedAt} title={signed.toLocaleString()}>
            {formatRelativeTime(row.signedAt)}
          </time>
          {row.binding ? (
            <>
              <span className="repo-signature-sep" aria-hidden="true">
                ·
              </span>
              <span className="mono" title={`${row.binding.sourceHead} → ${row.binding.targetHead}`}>
                {shortSha(row.binding.sourceHead)} → {shortSha(row.binding.targetHead)}
              </span>
            </>
          ) : null}
        </p>
      </div>
      <div className="repo-signature-actions">
        <button
          type="button"
          className="btn ghost small"
          onClick={() => setViewOpen(true)}
          data-testid="repo-signature-view"
        >
          <Eye size={12} aria-hidden="true" className="button-label-icon" />
          View
        </button>
        {canRevoke && !row.revoked ? (
          <div data-testid="signature-revoke">
            <RevokeSignatureButton
              signatureId={row.id}
              namespace={namespace}
              repo={repo}
              candidateCommits={
                row.binding ? revocableCommitsFromBinding(row.binding) : undefined
              }
              onRevoked={onRevoked}
            />
          </div>
        ) : null}
      </div>

      {viewOpen ? (
        <Modal title="Signature" onClose={() => setViewOpen(false)}>
          <div className="repo-signature-detail" data-testid="repo-signature-detail">
            <dl className="repo-signature-detail-grid">
              <div>
                <dt>Id</dt>
                <dd className="mono small">{row.id}</dd>
              </div>
              <div>
                <dt>Meaning</dt>
                <dd>{row.meaning}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  {row.revoked
                    ? `Revoked (${row.revocationCount} record${row.revocationCount === 1 ? '' : 's'})`
                    : 'Active'}
                </dd>
              </div>
              <div>
                <dt>Signed</dt>
                <dd>
                  <time dateTime={row.signedAt}>{signed.toLocaleString()}</time>
                </dd>
              </div>
              <div>
                <dt>Signer</dt>
                <dd>
                  <UserRef author={signerAuthor} name={row.signer.name} />
                  <span className="muted small mono">
                    {' '}
                    ({row.signer.iss} · {row.signer.sub})
                  </span>
                </dd>
              </div>
              {row.changeControlId ? (
                <div>
                  <dt>Change control</dt>
                  <dd className="mono small">{row.changeControlId}</dd>
                </div>
              ) : null}
              {row.binding ? (
                <>
                  <div>
                    <dt>Repository</dt>
                    <dd className="mono small">{row.binding.repo}</dd>
                  </div>
                  <div>
                    <dt>Incoming tip</dt>
                    <dd className="mono small">{row.binding.sourceHead}</dd>
                  </div>
                  <div>
                    <dt>Target tip (at sign)</dt>
                    <dd className="mono small">{row.binding.targetHead}</dd>
                  </div>
                  <div>
                    <dt>Manifest digest</dt>
                    <dd className="mono small">{row.binding.manifestDigest}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>Binding</dt>
                  <dd className="muted">None</dd>
                </div>
              )}
            </dl>
            <div className="modal-actions btn-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setViewOpen(false)}
              >
                Close
              </button>
              {canRevoke && !row.revoked ? (
                <RevokeSignatureButton
                  signatureId={row.id}
                  namespace={namespace}
                  repo={repo}
                  candidateCommits={
                    row.binding ? revocableCommitsFromBinding(row.binding) : undefined
                  }
                  onRevoked={() => {
                    setViewOpen(false)
                    onRevoked()
                  }}
                />
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </li>
  )
}
