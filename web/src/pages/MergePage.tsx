import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CommitList } from '../components/CommitList'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  pickOtherBranch,
  resolveDefaultBranch,
} from '../lib/lastBranch'
import {
  checkMergeable,
  listBranches,
  mergeBranches,
} from '../lib/oxen/api'
import { OxenApiError } from '../lib/oxen/types'

function SwapIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M3.5 2.75a.75.75 0 0 1 1.5 0v7.69l1.22-1.22a.75.75 0 1 1 1.06 1.06l-2.5 2.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 1.06-1.06L3.5 10.44V2.75Zm7.78.28a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 1 1-1.06 1.06L12.5 5.31v7.94a.75.75 0 0 1-1.5 0V5.31l-1.28 1.28a.75.75 0 1 1-1.06-1.06l2.5-2.5a.75.75 0 0 1 .12-.1Z"
      />
    </svg>
  )
}

function BranchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M5 3.25a1.75 1.75 0 1 1-1.5 2.8v1.4A2.75 2.75 0 0 0 6.25 10.2h1.9v-.95a1.75 1.75 0 1 1 1.5 0v.95h1.1A2.75 2.75 0 0 0 13.5 7.45V5.95a1.75 1.75 0 1 1 1.5 0v1.5A4.25 4.25 0 0 1 10.75 11.7H9.65v1.05a1.75 1.75 0 1 1-1.5 0V11.7H6.25A4.25 4.25 0 0 1 2 7.45V6.05a1.75 1.75 0 0 1 3-1.8Z"
      />
    </svg>
  )
}

export function MergePage() {
  const { namespace = '', repo = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const branches = useAsync(
    (signal) => listBranches(namespace, repo, signal),
    [namespace, repo],
  )

  const branchNames = useMemo(
    () =>
      branches.kind === 'ok'
        ? branches.data.branches.map((b) => b.name)
        : [],
    [branches],
  )

  const defaultBranch = useMemo(
    () => resolveDefaultBranch(branchNames, namespace, repo),
    [branchNames, namespace, repo],
  )

  const base = params.get('base') || defaultBranch
  const head = params.get('head') || ''

  const canCheck =
    branches.kind === 'ok' &&
    Boolean(base) &&
    Boolean(head) &&
    base !== head &&
    branchNames.includes(base) &&
    branchNames.includes(head)

  const mergeable = useAsync(
    (signal) =>
      canCheck
        ? checkMergeable(namespace, repo, base, head, signal)
        : Promise.resolve(null),
    [namespace, repo, base, head, canCheck],
  )

  const didAutoRange = useRef(false)
  useEffect(() => {
    if (branches.kind !== 'ok' || didAutoRange.current) return
    const names = branches.data.branches.map((b) => b.name)
    const resolvedBase = names.includes(base) ? base : defaultBranch
    const headInList = Boolean(head) && names.includes(head)
    // Keep any valid explicit head, including same-branch empty state.
    if (resolvedBase === base && headInList) {
      didAutoRange.current = true
      return
    }
    const other = pickOtherBranch(names, resolvedBase)
    didAutoRange.current = true
    setResult(null)
    setError(null)
    if (other) {
      setParams({ base: resolvedBase, head: other })
    } else {
      setParams({ base: resolvedBase, head: resolvedBase })
    }
  }, [branches, base, head, defaultBranch, setParams])

  function setRange(nextBase: string, nextHead: string) {
    setResult(null)
    setError(null)
    setParams({ base: nextBase, head: nextHead })
  }

  function swapBranches() {
    if (!base || !head || base === head) return
    setRange(head, base)
  }

  async function onMerge() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await mergeBranches(namespace, repo, base, head)
      setResult(
        `Merged ${res.commits.head.id.slice(0, 8)} into ${res.commits.base.id.slice(0, 8)} → ${res.commits.merge.id.slice(0, 8)}`,
      )
      mergeable.reload()
      branches.reload()
    } catch (err) {
      setError(
        err instanceof OxenApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Merge failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const basePath = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const compareHref = `${basePath}/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`
  const selectOptions = branchNames.length > 0 ? branchNames : [base || defaultBranch]

  const mergeData =
    mergeable.kind === 'ok' && mergeable.data ? mergeable.data : null
  const commitCount = mergeData?.commits.length ?? 0
  const conflictCount = mergeData?.conflicts.length ?? 0
  const isMergeable = Boolean(mergeData?.is_mergeable) && conflictCount === 0
  const baseTip =
    branches.kind === 'ok'
      ? branches.data.branches.find((b) => b.name === base)?.commit_id
      : undefined
  const headTip =
    branches.kind === 'ok'
      ? branches.data.branches.find((b) => b.name === head)?.commit_id
      : undefined
  const tipsMatch = Boolean(baseTip && headTip && baseTip === headTip)
  const nothingToMerge =
    canCheck &&
    (tipsMatch || (Boolean(mergeData) && commitCount === 0 && isMergeable))

  return (
    <main className="page merge-page">
      <div className="merge-page-head">
        <div>
          <h1 className="merge-title">Merge</h1>
          <p className="lede">
            Bring commits from one branch into another on this oxen-server
            repository.
          </p>
        </div>
        <Link
          className={`btn ghost${canCheck ? '' : ' is-disabled'}`}
          to={canCheck ? compareHref : `${basePath}/compare`}
          aria-disabled={!canCheck}
          tabIndex={canCheck ? undefined : -1}
          onClick={(e) => {
            if (!canCheck) e.preventDefault()
          }}
        >
          View diff
        </Link>
      </div>

      <div className="merge-range" aria-label="Merge range">
        <label className="merge-branch-pick">
          <span className="merge-branch-label">From</span>
          <span className="merge-branch-control">
            <BranchIcon />
            <select
              value={head || selectOptions[0]}
              onChange={(e) => setRange(base || defaultBranch, e.target.value)}
              disabled={branches.kind !== 'ok'}
              aria-label="Head branch (from)"
            >
              {selectOptions.map((name) => (
                <option key={`head-${name}`} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </span>
        </label>

        <button
          type="button"
          className="icon-round merge-swap"
          onClick={swapBranches}
          disabled={!canCheck}
          title="Swap branches"
          aria-label="Swap base and head branches"
        >
          <SwapIcon />
        </button>

        <label className="merge-branch-pick">
          <span className="merge-branch-label">Into</span>
          <span className="merge-branch-control">
            <BranchIcon />
            <select
              value={base || defaultBranch}
              onChange={(e) => setRange(e.target.value, head || e.target.value)}
              disabled={branches.kind !== 'ok'}
              aria-label="Base branch (into)"
            >
              {selectOptions.map((name) => (
                <option key={`base-${name}`} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </span>
        </label>

        <code className="merge-range-key mono muted">
          {base}..{head || '—'}
        </code>
      </div>

      {branches.kind === 'loading' && (
        <p className="muted">Loading branches…</p>
      )}
      {branches.kind === 'error' && (
        <p className="flash flash-error" role="status">{branches.message}</p>
      )}

      {branches.kind === 'ok' && branchNames.length < 2 && (
        <div className="merge-empty panel">
          <p className="muted">
            You need at least two branches to merge. Create one on the{' '}
            <Link to={`${basePath}/branches`}>Branches</Link> page.
          </p>
        </div>
      )}

      {branches.kind === 'ok' && branchNames.length >= 2 && !canCheck && (
        <p className="muted">Pick two different branches to merge.</p>
      )}

      {canCheck && (
        <StateBlock
          loading={mergeable.kind === 'loading'}
          error={mergeable.kind === 'error' ? mergeable.message : null}
        >
          {mergeData && (
            <>
              <div className="merge-summary" aria-live="polite">
                <span
                  className={`merge-status-pill ${
                    nothingToMerge
                      ? 'is-neutral'
                      : isMergeable
                        ? 'is-ok'
                        : 'is-bad'
                  }`}
                >
                  {nothingToMerge
                    ? 'Already up to date'
                    : isMergeable
                      ? 'Mergeable'
                      : 'Not mergeable'}
                </span>
                <span className="muted">·</span>
                <span>
                  {tipsMatch
                    ? '0 commits'
                    : `${commitCount} commit${commitCount === 1 ? '' : 's'}`}
                </span>
                {conflictCount > 0 && (
                  <>
                    <span className="muted">·</span>
                    <span className="error-text">
                      {conflictCount} conflict
                      {conflictCount === 1 ? '' : 's'}
                    </span>
                  </>
                )}
              </div>

              {conflictCount > 0 && (
                <section className="panel merge-conflicts">
                  <h2 className="section-label">Conflicts</h2>
                  <ul className="merge-conflict-list">
                    {mergeData.conflicts.map((c, i) => (
                      <li key={i} className="mono">
                        {typeof c.path === 'string'
                          ? c.path
                          : JSON.stringify(c)}
                      </li>
                    ))}
                  </ul>
                  <p className="muted small">
                    Resolve conflicts on the branches (or via Compare), then
                    try again.
                  </p>
                </section>
              )}

              <section className="panel merge-commits">
                <div className="merge-section-head">
                  <h2 className="section-label">Commits to merge</h2>
                  <span className="muted small">
                    {head} → {base}
                  </span>
                </div>
                {tipsMatch || commitCount === 0 ? (
                  <p className="muted">Nothing to merge.</p>
                ) : (
                  <CommitList
                    namespace={namespace}
                    repo={repo}
                    commits={mergeData.commits}
                  />
                )}

                <div className="merge-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || !isMergeable || nothingToMerge}
                    onClick={() => void onMerge()}
                  >
                    {busy ? 'Merging…' : `Merge ${head} → ${base}`}
                  </button>
                  <Link className="btn ghost" to={compareHref}>
                    View diff
                  </Link>
                </div>
              </section>
            </>
          )}
        </StateBlock>
      )}

      {result && (
        <p className="ok merge-result" role="status">
          {result}
        </p>
      )}
      {error && (
        <p className="error merge-result" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}
