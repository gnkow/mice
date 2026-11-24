import { Ban, Check, Eye, GitPullRequest, RefreshCw, RotateCcw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BranchesSubNav } from '../components/BranchesSubNav'
import { MergeRequestSignPanel } from '../components/MergeRequestSignPanel'
import { RevokeSignatureButton } from '../components/RevokeSignatureButton'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { usePrincipalProfiles } from '../components/CommitEmail'
import { UserRef } from '../components/UserRef'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthMe } from '../lib/auth'
import { fetchRepoPermissions } from '../lib/authzApi'
import {
  cancelMergeRequest,
  isSelfSignBlocked,
  listMergeRequests,
  mergeRefusalMessage,
  mergeRequestTitle,
  rejectMergeRequest,
  reopenMergeRequest,
  updateMergeRequestHeads,
  type MergeRequest,
  type MergeRequestStatus,
} from '../lib/mergeRequests'
import { askReason } from '../lib/reasonPrompt'
import { formatRelativeTime } from '../lib/time'

type StatusTab = 'open' | 'merged' | 'rejected' | 'cancelled'

const STATUS_TABS: Array<{ id: StatusTab; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'merged', label: 'Merged' },
  { id: 'rejected', label: 'Rejected' },
]

function matchesStatusTab(status: MergeRequestStatus, tab: StatusTab): boolean {
  switch (tab) {
    case 'open':
      return status === 'open' || status === 'stale'
    case 'merged':
      return status === 'merged'
    case 'rejected':
      return status === 'rejected'
    case 'cancelled':
      return status === 'cancelled'
  }
}

function parseStatusTab(raw: string | null): StatusTab {
  if (raw === 'merged' || raw === 'rejected' || raw === 'cancelled') return raw
  if (raw === 'refused') return 'rejected'
  return 'open'
}

function statusTagClass(status: MergeRequestStatus): string {
  switch (status) {
    case 'open':
      return 'ns-tag ns-tag-accent'
    case 'stale':
      return 'ns-tag ns-tag-warn'
    case 'rejected':
    case 'cancelled':
      return 'ns-tag ns-tag-warn'
    case 'merged':
      return 'ns-tag ns-tag-muted'
    default:
      return 'ns-tag'
  }
}

function statusLabel(status: MergeRequestStatus): string {
  return status
}

function MergeRequestRow({
  mr,
  base,
  busy,
  selfSignBlocked,
  profiles,
  onSign,
  onCancel,
  onReject,
  onReopen,
  onUpdate,
  onRevoked,
  canWrite,
  canApprove,
}: {
  mr: MergeRequest
  base: string
  busy: boolean
  selfSignBlocked: boolean
  canWrite: boolean
  canApprove: boolean
  profiles: { emails: Record<string, string>; names: Record<string, string> }
  onSign: (id: string) => void
  onCancel: (mr: MergeRequest) => void
  onReject: (mr: MergeRequest) => void
  onReopen: (mr: MergeRequest) => void
  onUpdate: (mr: MergeRequest) => void
  onRevoked: () => void
}) {
  const detailHref = `${base}/merge-requests/${encodeURIComponent(mr.id)}`
  const created = new Date(mr.createdAt)
  const actionable = mr.status === 'open' || mr.status === 'stale'
  const merged = mr.status === 'merged'
  const cancelled = mr.status === 'cancelled'
  const rejected = mr.status === 'rejected'
  const stale = mr.status === 'stale'
  const canRevokeMerged =
    merged &&
    canApprove &&
    Boolean(mr.signatureId) &&
    mr.signatureRevoked !== true
  const title = mergeRequestTitle(mr)
  const selfSignTitle = mergeRefusalMessage(
    'self_merge',
    'Self-merge forbidden (4-eyes principle)',
  )
  const staleTitle = mergeRefusalMessage(
    'stale',
    'Source or target moved — Update this request before Approve.',
  )

  return (
    <li className="mr-row">
      <div className="mr-row-main">
        <div className="mr-row-title">
          <Link className="mr-row-heading" to={detailHref}>
            {title}
          </Link>
          <span className={statusTagClass(mr.status)}>{statusLabel(mr.status)}</span>
        </div>
        <p className="mr-row-id muted small mono">{mr.id}</p>
        <p className="mr-row-range muted small">
          <span className="mono">{mr.sourceBranch}</span>
          <span className="mr-arrow" aria-hidden="true">
            {' '}
            →{' '}
          </span>
          <span className="mono">{mr.targetBranch}</span>
        </p>
        {mr.description.trim() ? (
          <p className="mr-row-desc muted small">{mr.description.trim()}</p>
        ) : null}
        <div className="mr-row-meta">
          <time
            className="muted small"
            dateTime={mr.createdAt}
            title={created.toLocaleString()}
          >
            {formatRelativeTime(mr.createdAt)}
          </time>
          <span className="mr-meta-sep muted" aria-hidden="true">
            ·
          </span>
          <span className="mr-opened-by">
            <span className="muted small">Opened by</span>{' '}
            <UserRef author={mr.openedBy} profiles={profiles} />
          </span>
        </div>
        <div className="mr-row-heads" aria-label="Pinned commit heads">
          <span className="mr-head">
            <span className="mr-head-label">From {mr.sourceBranch}</span>
            <span className="commit-sha mono" title={mr.expectedSourceHead}>
              {mr.expectedSourceHead.slice(0, 8)}
            </span>
          </span>
          <span className="mr-head">
            <span className="mr-head-label">Into {mr.targetBranch}</span>
            <span className="commit-sha mono" title={mr.expectedTargetHead}>
              {mr.expectedTargetHead.slice(0, 8)}
            </span>
          </span>
        </div>
      </div>
      <div className="mr-row-actions">
        <Link className="btn ghost" to={detailHref}>
          <Eye size={14} aria-hidden="true" className="button-label-icon" />
          View
        </Link>
        {actionable ? (
          <>
            {stale && canWrite ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                title={staleTitle}
                onClick={() => onUpdate(mr)}
              >
                <RefreshCw size={14} aria-hidden="true" className="button-label-icon" />
                Update
              </button>
            ) : null}
            {canApprove ? (
              <button
                type="button"
                className={
                  selfSignBlocked || stale ? 'btn primary is-disabled' : 'btn primary'
                }
                disabled={busy || selfSignBlocked || stale}
                aria-disabled={selfSignBlocked || stale || undefined}
                title={
                  stale ? staleTitle : selfSignBlocked ? selfSignTitle : undefined
                }
                onClick={() => {
                  if (selfSignBlocked || stale) return
                  onSign(mr.id)
                }}
              >
                <Check size={14} aria-hidden="true" className="button-label-icon" />
                Approve
              </button>
            ) : null}
            {canApprove ? (
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                title="Refuse this merge request as Approver"
                onClick={() => onReject(mr)}
              >
                <Ban size={14} aria-hidden="true" className="button-label-icon" />
                Reject
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                title="Withdraw this merge request"
                onClick={() => onCancel(mr)}
              >
                <X size={14} aria-hidden="true" className="button-label-icon" />
                Cancel
              </button>
            ) : null}
          </>
        ) : null}
        {cancelled && canWrite ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            title="Reopen this cancelled merge request"
            onClick={() => onReopen(mr)}
          >
            <RotateCcw size={14} aria-hidden="true" className="button-label-icon" />
            Reopen
          </button>
        ) : null}
        {rejected && canApprove ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            title="Revert reject — restore this request so it can be approved"
            onClick={() => onReopen(mr)}
          >
            <RotateCcw size={14} aria-hidden="true" className="button-label-icon" />
            Revert reject
          </button>
        ) : null}
        {canRevokeMerged && mr.signatureId ? (
          <div className="mr-row-revoke" data-testid="mr-merged-revoke">
            <RevokeSignatureButton
              signatureId={mr.signatureId}
              namespace={mr.namespace}
              repo={mr.repo}
              candidateCommits={[
                { id: mr.expectedSourceHead, role: 'Incoming tip' },
                ...(mr.mergeCommitId
                  ? [{ id: mr.mergeCommitId, role: 'Merge commit' }]
                  : []),
              ]}
              onRevoked={onRevoked}
            />
          </div>
        ) : null}
        {merged && canApprove && mr.signatureRevoked ? (
          <span className="ns-tag ns-tag-warn" data-testid="signature-revoked-tag">
            Revoked
          </span>
        ) : null}
      </div>
    </li>
  )
}

/** Lists BFF merge requests; Sign opens the shared reason/signature ceremony modal. */
export function MergeRequestsPage() {
  const { namespace = '', repo = '' } = useParams()
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const [params, setParams] = useSearchParams()
  const state = useAsync(
    (signal) => listMergeRequests(namespace, repo, signal),
    [namespace, repo],
  )
  const me = useAsync((signal) => fetchAuthMe(signal), [])
  const repoPerms = useAsync(
    (signal) => fetchRepoPermissions(namespace, repo, signal),
    [namespace, repo],
  )
  const canWrite = repoPerms.kind === 'ok' && repoPerms.data.contentsWrite === true
  const canApprove = repoPerms.kind === 'ok' && repoPerms.data.isApprover === true
  const signer =
    me.kind === 'ok' && me.data.authenticated ? me.data.user : null
  const [signId, setSignId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [filter, setFilter] = useState(params.get('q') ?? '')
  const statusTab = parseStatusTab(params.get('status'))

  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const statusCounts = useMemo(() => {
    const counts: Record<StatusTab, number> = {
      open: 0,
      merged: 0,
      rejected: 0,
      cancelled: 0,
    }
    if (state.kind !== 'ok') return counts
    for (const mr of state.data) {
      for (const tab of STATUS_TABS) {
        if (matchesStatusTab(mr.status, tab.id)) counts[tab.id] += 1
      }
    }
    return counts
  }, [state])

  const filtered = useMemo(() => {
    if (state.kind !== 'ok') return []
    const byStatus = state.data.filter((mr) => matchesStatusTab(mr.status, statusTab))
    const q = filter.trim().toLowerCase()
    if (!q) return byStatus
    return byStatus.filter((mr) => {
      const title = mergeRequestTitle(mr).toLowerCase()
      const desc = (mr.description ?? '').toLowerCase()
      const id = mr.id.toLowerCase()
      const range = `${mr.sourceBranch} ${mr.targetBranch}`.toLowerCase()
      const label = statusLabel(mr.status)
      return (
        title.includes(q) ||
        desc.includes(q) ||
        id.includes(q) ||
        range.includes(q) ||
        mr.status.toLowerCase().includes(q) ||
        label.includes(q)
      )
    })
  }, [state, filter, statusTab])

  const openerAuthors = useMemo(
    () => (state.kind === 'ok' ? state.data.map((mr) => mr.openedBy) : []),
    [state],
  )
  const profiles = usePrincipalProfiles(openerAuthors)

  const slice = paginate(filtered, page, PAGE_SIZE)

  function goPage(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next <= 1) nextParams.delete('page')
    else nextParams.set('page', String(next))
    setParams(nextParams, { replace: true })
  }

  function onStatusTab(tab: StatusTab) {
    const nextParams = new URLSearchParams(params)
    if (tab === 'open') nextParams.delete('status')
    else nextParams.set('status', tab)
    nextParams.delete('page')
    setParams(nextParams, { replace: true })
  }

  function onFilterChange(value: string) {
    setFilter(value)
    const nextParams = new URLSearchParams(params)
    if (value.trim()) nextParams.set('q', value.trim())
    else nextParams.delete('q')
    nextParams.delete('page')
    setParams(nextParams, { replace: true })
  }

  async function onCancel(mr: MergeRequest) {
    setActionError(null)
    setBusyId(mr.id)
    try {
      const path = `/auth/merge-requests/${encodeURIComponent(mr.id)}/cancel`
      const ceremony = await askReason({
        changeSummary: `Cancel merge request ${mergeRequestTitle(mr)} on ${namespace}/${repo}`,
        detail: 'Withdraw this request. An electronic signature is required.',
        method: 'POST',
        path,
        body: {},
      })
      if (!ceremony?.signatureId) return
      await cancelMergeRequest(mr.id, {
        reason: ceremony.reason,
        signatureId: ceremony.signatureId,
        changeControlId: ceremony.changeControlId,
      })
      state.reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Cancel failed')
    } finally {
      setBusyId(null)
    }
  }

  async function onReject(mr: MergeRequest) {
    setActionError(null)
    setBusyId(mr.id)
    try {
      const path = `/auth/merge-requests/${encodeURIComponent(mr.id)}/reject`
      const ceremony = await askReason({
        changeSummary: `Reject merge request ${mergeRequestTitle(mr)} on ${namespace}/${repo}`,
        detail: 'Refuse this request as Approver. An electronic signature is required.',
        method: 'POST',
        path,
        body: {},
      })
      if (!ceremony?.signatureId) return
      await rejectMergeRequest(mr.id, {
        reason: ceremony.reason,
        signatureId: ceremony.signatureId,
        changeControlId: ceremony.changeControlId,
      })
      state.reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Reject failed')
    } finally {
      setBusyId(null)
    }
  }

  async function onReopen(mr: MergeRequest) {
    setActionError(null)
    setBusyId(mr.id)
    const revertingReject = mr.status === 'rejected'
    try {
      const path = `/auth/merge-requests/${encodeURIComponent(mr.id)}/reopen`
      const ceremony = await askReason({
        changeSummary: revertingReject
          ? `Revert reject on merge request ${mergeRequestTitle(mr)} on ${namespace}/${repo}`
          : `Reopen merge request ${mergeRequestTitle(mr)} on ${namespace}/${repo}`,
        detail: revertingReject
          ? 'Undo the Approver refuse so this request can be approved. An electronic signature is required.'
          : 'Restore this cancelled request. An electronic signature is required.',
        method: 'POST',
        path,
        body: { refreshExpected: true },
      })
      if (!ceremony?.signatureId) return
      await reopenMergeRequest(mr.id, {
        reason: ceremony.reason,
        signatureId: ceremony.signatureId,
        changeControlId: ceremony.changeControlId,
      })
      const nextParams = new URLSearchParams(params)
      nextParams.set('status', 'open')
      nextParams.delete('page')
      setParams(nextParams, { replace: true })
      state.reload()
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : revertingReject
            ? 'Revert reject failed'
            : 'Reopen failed',
      )
    } finally {
      setBusyId(null)
    }
  }

  async function onUpdate(mr: MergeRequest) {
    setActionError(null)
    setBusyId(mr.id)
    try {
      const path = `/auth/merge-requests/${encodeURIComponent(mr.id)}/resync`
      const ceremony = await askReason({
        changeSummary: `Update merge request ${mergeRequestTitle(mr)} on ${namespace}/${repo}`,
        detail:
          'Source or target moved — refresh expected heads before Approve. An electronic signature is required.',
        method: 'POST',
        path,
        body: { refreshExpected: true },
      })
      if (!ceremony?.signatureId) return
      await updateMergeRequestHeads(mr.id, {
        reason: ceremony.reason,
        signatureId: ceremony.signatureId,
        changeControlId: ceremony.changeControlId,
      })
      state.reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="page">
      <BranchesSubNav />
      <div className="page-head">
        <div>
          <h1>
            <GitPullRequest
              size={20}
              aria-hidden="true"
              className="button-label-icon"
            />
            Requests
          </h1>
          <p className="lede">
            Open requests into validated branches are signed in the browser. The CLI
            prints a link here after opening a request.
          </p>
        </div>
      </div>

      {actionError ? (
        <p className="error" role="alert">
          {actionError}
        </p>
      ) : null}

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
      >
        {state.kind === 'ok' ? (
          <>
            <div
              className="tab-bar mr-status-tabs"
              role="tablist"
              aria-label="Filter requests by status"
            >
              {STATUS_TABS.map((tab) => {
                const selected = statusTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`mr-tab-${tab.id}`}
                    aria-selected={selected}
                    className={selected ? 'active' : undefined}
                    onClick={() => onStatusTab(tab.id)}
                  >
                    {tab.label}
                    <span className="mr-status-count muted">{statusCounts[tab.id]}</span>
                  </button>
                )
              })}
            </div>
            <div className="mr-list-toolbar">
              <label className="mr-search">
                <Search size={14} aria-hidden="true" className="button-label-icon" />
                <span className="sr-only">Search requests</span>
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => onFilterChange(e.target.value)}
                  placeholder="Search title, description, branch, id…"
                  autoComplete="off"
                />
              </label>
            </div>
            {filtered.length === 0 ? (
              <p className="muted" role="tabpanel" aria-labelledby={`mr-tab-${statusTab}`}>
                {state.data.length === 0
                  ? 'No merge requests yet.'
                  : statusCounts[statusTab] === 0
                    ? `No ${STATUS_TABS.find((t) => t.id === statusTab)?.label.toLowerCase()} requests.`
                    : 'No requests match this search.'}
              </p>
            ) : (
              <>
                <ul
                  className="mr-list"
                  role="tabpanel"
                  aria-labelledby={`mr-tab-${statusTab}`}
                >
                  {slice.items.map((mr) => (
                    <MergeRequestRow
                      key={mr.id}
                      mr={mr}
                      base={base}
                      busy={busyId === mr.id}
                      selfSignBlocked={isSelfSignBlocked({
                        signer,
                        openedBy: mr.openedBy,
                      })}
                      profiles={profiles}
                      onSign={setSignId}
                      onCancel={onCancel}
                      onReject={onReject}
                      onReopen={onReopen}
                      onUpdate={onUpdate}
                      onRevoked={() => state.reload()}
                      canWrite={canWrite}
                      canApprove={canApprove}
                    />
                  ))}
                </ul>
                <Pagination
                  page={slice.page}
                  pageCount={slice.pageCount}
                  onPageChange={goPage}
                  total={slice.total}
                  label="Requests pagination"
                />
              </>
            )}
          </>
        ) : null}
      </StateBlock>

      {signId ? (
        <MergeRequestSignPanel
          mergeRequestId={signId}
          namespace={namespace}
          repo={repo}
          embedded
          onDismiss={() => setSignId(null)}
          onComplete={() => state.reload()}
        />
      ) : null}
    </main>
  )
}
