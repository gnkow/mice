import { Check, Eye, GitPullRequest, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BranchesSubNav } from '../components/BranchesSubNav'
import { MergeRequestSignPanel } from '../components/MergeRequestSignPanel'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { usePrincipalProfiles } from '../components/CommitEmail'
import { UserRef } from '../components/UserRef'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthMe } from '../lib/auth'
import {
  isSelfSignBlocked,
  listMergeRequests,
  mergeRefusalMessage,
  mergeRequestTitle,
  rejectMergeRequest,
  type MergeRequest,
  type MergeRequestStatus,
} from '../lib/mergeRequests'
import { askReason } from '../lib/reasonPrompt'
import { formatRelativeTime } from '../lib/time'

function statusTagClass(status: MergeRequestStatus): string {
  switch (status) {
    case 'open':
      return 'ns-tag ns-tag-accent'
    case 'stale':
      return 'ns-tag ns-tag-warn'
    case 'blocked':
      return 'ns-tag ns-tag-warn'
    case 'merged':
      return 'ns-tag ns-tag-muted'
    default:
      return 'ns-tag'
  }
}

function MergeRequestRow({
  mr,
  base,
  busy,
  selfSignBlocked,
  profiles,
  onSign,
  onReject,
}: {
  mr: MergeRequest
  base: string
  busy: boolean
  selfSignBlocked: boolean
  profiles: { emails: Record<string, string>; names: Record<string, string> }
  onSign: (id: string) => void
  onReject: (mr: MergeRequest) => void
}) {
  const detailHref = `${base}/merge-requests/${encodeURIComponent(mr.id)}`
  const created = new Date(mr.createdAt)
  const canAct = mr.status === 'open' || mr.status === 'stale'
  const title = mergeRequestTitle(mr)
  const selfSignTitle = mergeRefusalMessage(
    'self_merge',
    'Self-merge forbidden (4-eyes principle)',
  )

  return (
    <li className="mr-row">
      <div className="mr-row-main">
        <div className="mr-row-title">
          <Link className="mr-row-heading" to={detailHref}>
            {title}
          </Link>
          <span className={statusTagClass(mr.status)}>{mr.status}</span>
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
        {canAct ? (
          <>
            <button
              type="button"
              className={
                selfSignBlocked ? 'btn primary is-disabled' : 'btn primary'
              }
              disabled={busy || selfSignBlocked}
              aria-disabled={selfSignBlocked || undefined}
              title={selfSignBlocked ? selfSignTitle : undefined}
              onClick={() => {
                if (selfSignBlocked) return
                onSign(mr.id)
              }}
            >
              <Check size={14} aria-hidden="true" className="button-label-icon" />
              Sign
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() => onReject(mr)}
            >
              <X size={14} aria-hidden="true" className="button-label-icon" />
              Reject
            </button>
          </>
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
  const signer =
    me.kind === 'ok' && me.data.authenticated ? me.data.user : null
  const [signId, setSignId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [filter, setFilter] = useState(params.get('q') ?? '')

  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const filtered = useMemo(() => {
    if (state.kind !== 'ok') return []
    const q = filter.trim().toLowerCase()
    if (!q) return state.data
    return state.data.filter((mr) => {
      const title = mergeRequestTitle(mr).toLowerCase()
      const desc = (mr.description ?? '').toLowerCase()
      const id = mr.id.toLowerCase()
      const range = `${mr.sourceBranch} ${mr.targetBranch}`.toLowerCase()
      return (
        title.includes(q) ||
        desc.includes(q) ||
        id.includes(q) ||
        range.includes(q) ||
        mr.status.toLowerCase().includes(q)
      )
    })
  }, [state, filter])

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

  function onFilterChange(value: string) {
    setFilter(value)
    const nextParams = new URLSearchParams(params)
    if (value.trim()) nextParams.set('q', value.trim())
    else nextParams.delete('q')
    nextParams.delete('page')
    setParams(nextParams, { replace: true })
  }

  async function onReject(mr: MergeRequest) {
    setActionError(null)
    setBusyId(mr.id)
    try {
      const path = `/auth/merge-requests/${encodeURIComponent(mr.id)}/reject`
      const ceremony = await askReason({
        changeSummary: `Reject merge request ${mergeRequestTitle(mr)} on ${namespace}/${repo}`,
        detail: 'An electronic signature is required to reject this merge request',
        method: 'POST',
        path,
        body: {},
      })
      if (!ceremony?.signatureId) return
      await rejectMergeRequest(mr.id, {
        reason: ceremony.reason,
        category: ceremony.category,
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
              <p className="muted">
                {state.data.length === 0
                  ? 'No merge requests yet.'
                  : 'No requests match this search.'}
              </p>
            ) : (
              <>
                <ul className="mr-list">
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
                      onReject={onReject}
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
