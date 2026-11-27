import { History as ActionHistory, Trash2 as ActionTrash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Breadcrumbs, repoCrumbs } from '../components/Breadcrumbs'
import { CommitDetailExpand } from '../components/CommitDetailExpand'
import { CommitList } from '../components/CommitList'
import { QcInvalidWarning } from '../components/QcInvalidWarning'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { useCommitQc } from '../hooks/useCommitQc'
import { fetchAuthMe } from '../lib/auth'
import { fetchCoveringSignature, fetchRepoPermissions } from '../lib/authzApi'
import {
  getRootCommit,
  listAllCommits,
  listBranches,
  listCommitHistory,
} from '../lib/oxen/api'
import { looksLikeCommitId } from '../lib/oxen/paths'

export function CommitsPage() {
  const { namespace = '', repo = '', commitId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<'history' | 'all'>('history')
  const revision = params.get('branch') || 'main'
  const pathFilter = params.get('path') || ''
  const [pathDraft, setPathDraft] = useState(pathFilter)

  useEffect(() => {
    setPathDraft(pathFilter)
  }, [pathFilter])

  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )
  const branchNames =
    branches.kind === 'ok'
      ? branches.data.branches.map((b) => b.name)
      : []
  const revisionIsBranch =
    branches.kind === 'ok'
      ? branchNames.includes(revision)
      : !looksLikeCommitId(revision)

  const repoPerms = useAsync(
    (signal) => fetchRepoPermissions(namespace, repo, signal),
    [namespace, repo],
  )
  const me = useAsync((signal) => fetchAuthMe(signal), [])
  const signer =
    me.kind === 'ok' && me.data.authenticated ? me.data.user : null
  const canRevoke =
    repoPerms.kind === 'ok' && repoPerms.data.isApprover === true
  const canWrite =
    repoPerms.kind === 'ok' && repoPerms.data.contentsWrite === true
  const canViewSignedRecord =
    repoPerms.kind === 'ok' && repoPerms.data.viewSignedRecord === true

  const history = useAsync(
    (signal) =>
      listCommitHistory(
        namespace,
        repo,
        revision,
        signal,
        pathFilter.trim() || undefined,
      ),
    [namespace, repo, revision, pathFilter],
  )
  const all = useAsync(
    (signal) => listAllCommits(namespace, repo, signal),
    [namespace, repo],
  )
  const root = useAsync(
    (signal) => getRootCommit(namespace, repo, signal),
    [namespace, repo],
  )

  const active = mode === 'history' ? history : all
  const {
    qc,
    summary: qcSummary,
    reload: reloadQc,
  } = useCommitQc(
    namespace,
    repo,
    active.kind === 'ok' ? active.data.commits : null,
  )
  const qcInvalid = useMemo(() => new Set(qcSummary.invalid), [qcSummary])
  const qcDescendants = useMemo(() => new Set(qcSummary.descendants), [qcSummary])
  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const linkSearch = params.toString() ? `?${params.toString()}` : ''
  const listHref = `${base}/commits${linkSearch}`

  // Drop selection when the commit leaves the current list (filter / mode change).
  useEffect(() => {
    if (active.kind !== 'ok' || !commitId) return
    const stillVisible = active.data.commits.some((c) => c.id === commitId)
    if (!stillVisible) navigate(listHref, { replace: true })
  }, [active, commitId, listHref, navigate])

  const listCommits =
    active.kind === 'ok' ? active.data.commits : null
  const validCommitKey = useMemo(() => {
    if (!canRevoke || !listCommits) return ''
    return listCommits
      .filter((c) => qc[c.id] === 'valid')
      .map((c) => c.id)
      .join(',')
  }, [canRevoke, listCommits, qc])

  /** List rows: covering signatures for Valid commits (branch-invariant). */
  const listCovering = useAsync(
    async (signal) => {
      const ids = validCommitKey ? validCommitKey.split(',').filter(Boolean) : []
      const map = new Map<string, { signatureId: string; revoked: boolean }>()
      if (!canRevoke || ids.length === 0) return map
      await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetchCoveringSignature(namespace, repo, id, signal)
            if (res.signature && !res.signature.revoked) {
              map.set(id, res.signature)
            }
          } catch {
            /* ignore — row simply omits revoke */
          }
        }),
      )
      return map
    },
    [namespace, repo, canRevoke, validCommitKey],
  )
  const coveringByCommit =
    listCovering.kind === 'ok' ? listCovering.data : undefined

  function setHistoryParams(nextRevision: string, nextPath: string) {
    const next: Record<string, string> = { branch: nextRevision }
    if (nextPath.trim()) next.path = nextPath.trim()
    setParams(next)
  }

  const revisionLabel = revisionIsBranch
    ? revision
    : `${revision.slice(0, 8)}${revision.length > 8 ? '…' : ''}`

  return (
    <main className="page wide history-page">
      <header className="history-page-head">
        <div className="history-page-head-main">
          <Breadcrumbs
            items={repoCrumbs(namespace, repo, {
              label: 'History',
              to: listHref,
            })}
          />
          <h1>History</h1>
          {root.kind === 'ok' && root.data.commit && (
            <p className="history-root muted small">
              Root{' '}
              <Link
                className="mono"
                to={`${base}/commits/${encodeURIComponent(root.data.commit.id)}${linkSearch}`}
              >
                {root.data.commit.id.slice(0, 8)}
              </Link>
              {' · '}
              {root.data.commit.message}
            </p>
          )}
        </div>

        <div className="history-toolbar">
          <div className="history-mode">
            <span className="history-mode-spacer" aria-hidden>
              Mode
            </span>
            <div className="seg" role="tablist" aria-label="History mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'history'}
                className={mode === 'history' ? 'active' : ''}
                onClick={() => setMode('history')}
              >
                <ActionHistory size={14} aria-hidden="true" className="button-label-icon" />Revision history
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'all'}
                className={mode === 'all' ? 'active' : ''}
                onClick={() => setMode('all')}
              >
                <ActionHistory size={14} aria-hidden="true" className="button-label-icon" />All commits
              </button>
            </div>
          </div>

          {mode === 'history' && (
            <div className="history-filters">
              <label className="branch-pick">
                Revision
                <select
                  value={revision}
                  onChange={(e) => setHistoryParams(e.target.value, pathFilter)}
                >
                  {branches.kind === 'ok' && !revisionIsBranch && (
                    <option value={revision}>
                      {revisionLabel} (commit)
                    </option>
                  )}
                  {branchNames.length > 0 ? (
                    branchNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))
                  ) : (
                    <option value={revision}>
                      {revisionIsBranch ? revision : `${revisionLabel} (commit)`}
                    </option>
                  )}
                </select>
              </label>
              <label className="branch-pick history-path-pick">
                Path
                <input
                  value={pathDraft}
                  onChange={(e) => setPathDraft(e.target.value)}
                  onBlur={() => {
                    if (pathDraft.trim() !== pathFilter.trim()) {
                      setHistoryParams(revision, pathDraft)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setHistoryParams(revision, pathDraft)
                    }
                  }}
                  placeholder="e.g. data or README.md"
                />
              </label>
              {pathFilter.trim() && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    setPathDraft('')
                    setHistoryParams(revision, '')
                  }}
                >
                  <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {mode === 'history' && pathFilter.trim() && (
        <p className="history-filter-note muted small">
          Showing commits that touch <code>{pathFilter.trim()}</code> on{' '}
          <code>{revisionLabel}</code>.
        </p>
      )}

      <QcInvalidWarning
        namespace={namespace}
        repo={repo}
        summary={qcSummary}
        scope={mode === 'history' ? `the history of ${revisionLabel}` : 'this repository'}
      />

      {active.kind === 'error' ? (
        <StateBlock error={active.message} errorPurpose="view commits" />
      ) : (
        <section className="history-list" aria-label="Commit list">
          <StateBlock
            loading={active.kind === 'loading'}
            empty={active.kind === 'ok' && active.data.commits.length === 0}
            emptyMessage={
              mode === 'history' && pathFilter.trim()
                ? `No commits touch “${pathFilter.trim()}” on ${revisionLabel}.`
                : 'No commits yet.'
            }
          >
            {active.kind === 'ok' && (
              <CommitList
                namespace={namespace}
                repo={repo}
                commits={active.data.commits}
                selectedId={commitId || undefined}
                listHref={listHref}
                linkSearch={linkSearch}
                qcByCommit={qc}
                qcInvalid={qcInvalid}
                qcDescendants={qcDescendants}
                canRevoke={canRevoke}
                coveringByCommit={coveringByCommit}
                onRevoked={() => {
                  listCovering.reload()
                  reloadQc()
                }}
                renderExpanded={(c) => (
                  <CommitDetailExpand
                    namespace={namespace}
                    repo={repo}
                    commit={c}
                    listQc={qc[c.id]}
                    descendsFromInvalid={qcDescendants.has(c.id)}
                    canWrite={canWrite}
                    canRevoke={canRevoke}
                    canViewSignedRecord={canViewSignedRecord}
                    signer={signer}
                    linkSearch={linkSearch}
                    onQcChanged={() => {
                      listCovering.reload()
                      reloadQc()
                    }}
                  />
                )}
              />
            )}
          </StateBlock>
        </section>
      )}
    </main>
  )
}
