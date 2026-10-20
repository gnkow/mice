import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { JobSummaryCard } from '../components/JobSummaryCard'
import { Modal } from '../components/Modal'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { SubmitJobBox } from '../components/SubmitJobBox'
import { useAsync } from '../hooks/useAsync'
import {
  JOB_LIST_SORTS,
  JOB_STATUSES,
  collectJobBranches,
  filterAndSortJobs,
  listJobs,
  parseJobListSort,
  parseJobRunner,
  parseJobStatus,
  type JobListSort,
  type JobRunnerKind,
  type JobStatus,
} from '../lib/jobs'

type SubmitMode = 'local' | 'cluster'

/** Repository jobs list — detail lives on JobPage. */
export function JobsPage() {
  const { namespace = '', repo = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [submitMode, setSubmitMode] = useState<SubmitMode | null>(null)
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const status = parseJobStatus(params.get('status'))
  const runner = parseJobRunner(params.get('runner'))
  const sort = parseJobListSort(params.get('sort'))
  const sourceBranch = (params.get('source') || '').trim()
  const targetBranch = (params.get('target') || '').trim()
  const q = params.get('q') ?? ''
  const [qDraft, setQDraft] = useState(q)

  useEffect(() => {
    setQDraft(q)
  }, [q])

  useEffect(() => {
    const raw = (params.get('submit') || '').trim().toLowerCase()
    if (!raw) return
    const mode: SubmitMode =
      raw === 'local' || raw === 'cluster' ? raw : 'cluster'
    setSubmitMode(mode)
    const next = new URLSearchParams(params)
    next.delete('submit')
    setParams(next, { replace: true })
  }, [params, setParams])

  const list = useAsync(
    (signal) => listJobs({ namespace, repo, limit: 100 }, signal),
    [namespace, repo],
  )
  const listReload = list.reload
  const jobs = list.kind === 'ok' ? list.data.jobs : []
  const hasJobs = list.kind === 'ok' && jobs.length > 0
  const branches = useMemo(() => collectJobBranches(jobs), [jobs])
  const filtered = filterAndSortJobs(jobs, {
    status,
    runner,
    source_branch: sourceBranch,
    target_branch: targetBranch,
    q,
    sort,
  })
  const slice = paginate(filtered, page, PAGE_SIZE)
  const filtersActive = Boolean(
    status ||
      runner ||
      sourceBranch ||
      targetBranch ||
      q.trim() ||
      sort !== 'created_desc',
  )

  useEffect(() => {
    if (!hasJobs) return
    const t = setInterval(() => listReload(), 4000)
    return () => clearInterval(t)
  }, [hasJobs, listReload])

  function patchParams(patch: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === '') next.delete(key)
      else next.set(key, value)
    }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }

  function goPage(nextPage: number) {
    patchParams(
      { page: nextPage <= 1 ? null : String(nextPage) },
      false,
    )
  }

  function setStatus(next: JobStatus | '') {
    patchParams({ status: next || null })
  }

  function setRunner(next: JobRunnerKind | '') {
    patchParams({ runner: next || null })
  }

  function setSort(next: JobListSort) {
    patchParams({ sort: next === 'created_desc' ? null : next })
  }

  function setSourceBranch(next: string) {
    patchParams({ source: next.trim() || null })
  }

  function setTargetBranch(next: string) {
    patchParams({ target: next.trim() || null })
  }

  function commitSearch(value: string) {
    const trimmed = value.trim()
    setQDraft(trimmed)
    patchParams({ q: trimmed || null })
  }

  function clearFilters() {
    setQDraft('')
    patchParams({
      status: null,
      runner: null,
      source: null,
      target: null,
      q: null,
      sort: null,
    })
  }

  function openSubmit(mode: SubmitMode, e?: MouseEvent<HTMLElement>) {
    const details = e?.currentTarget.closest('details')
    if (details) details.removeAttribute('open')
    setSubmitMode(mode)
  }

  return (
    <div className="page-stack">
      <header className="page-header page-head">
        <div>
          <h1>Jobs</h1>
          <p className="lede">
            Container jobs for this repository —{' '}
            <span className="pill runner-local">Local</span> (CLI; shown here
            after <span className="mono">mice push</span>) or{' '}
            <span className="pill runner-cluster">Cluster</span> (auth BFF /{' '}
            <span className="mono">JOBS_RUNNER</span>). Open a job for status,
            logs, and results.
          </p>
        </div>
        <div className="btn-row">
          <details className="clone-dropdown submit-job-dropdown">
            <summary className="btn primary">New job</summary>
            <div className="clone-dropdown-panel submit-job-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="submit-job-option"
                onClick={(e) => openSubmit('local', e)}
              >
                <span className="pill runner-local">Local</span>
                <span className="submit-job-option-text">
                  <b>Run on your machine</b>
                  <span className="muted small">
                    <span className="mono">mice job run</span> · Docker + local
                    commit
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="submit-job-option"
                onClick={(e) => openSubmit('cluster', e)}
              >
                <span className="pill runner-cluster">Cluster</span>
                <span className="submit-job-option-text">
                  <b>Queue on the server</b>
                  <span className="muted small">
                    Auth BFF · Docker or Kubernetes
                  </span>
                </span>
              </button>
            </div>
          </details>
          <Link className="btn ghost" to="/jobs">
            All jobs
          </Link>
        </div>
      </header>

      {hasJobs && (
        <div className="jobs-toolbar" role="search" aria-label="Filter jobs">
          <label className="jobs-toolbar-field">
            <span className="jobs-toolbar-label">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(parseJobStatus(e.target.value))}
            >
              <option value="">All</option>
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-toolbar-field">
            <span className="jobs-toolbar-label">Runner</span>
            <select
              value={runner}
              onChange={(e) => setRunner(parseJobRunner(e.target.value))}
            >
              <option value="">All</option>
              <option value="local">Local</option>
              <option value="cluster">Cluster</option>
            </select>
          </label>
          <label className="jobs-toolbar-field">
            <span className="jobs-toolbar-label">Source</span>
            <select
              value={sourceBranch}
              onChange={(e) => setSourceBranch(e.target.value)}
            >
              <option value="">All</option>
              {sourceBranch && !branches.source.includes(sourceBranch) ? (
                <option value={sourceBranch}>{sourceBranch}</option>
              ) : null}
              {branches.source.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-toolbar-field">
            <span className="jobs-toolbar-label">Target</span>
            <select
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
            >
              <option value="">All</option>
              {targetBranch && !branches.target.includes(targetBranch) ? (
                <option value={targetBranch}>{targetBranch}</option>
              ) : null}
              {branches.target.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-toolbar-field">
            <span className="jobs-toolbar-label">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(parseJobListSort(e.target.value))}
            >
              {JOB_LIST_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="jobs-toolbar-field jobs-toolbar-search">
            <span className="jobs-toolbar-label">Search</span>
            <input
              type="search"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitSearch(qDraft)
                }
              }}
              onBlur={() => {
                if (qDraft.trim() !== q.trim()) commitSearch(qDraft)
              }}
              placeholder="Name, id, image, command…"
              autoComplete="off"
            />
          </label>
          <div className="jobs-toolbar-meta">
            <p className="muted small">
              {filtered.length} of {jobs.length}
              {filtersActive ? ' matching' : ''}
            </p>
            {filtersActive && (
              <button
                type="button"
                className="btn ghost small"
                onClick={clearFilters}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <StateBlock
        loading={list.kind === 'loading' && !jobs.length}
        error={list.kind === 'error' && !jobs.length ? list.message : null}
        onRetry={() => listReload()}
        empty={list.kind === 'ok' && jobs.length === 0}
        emptyMessage="No jobs yet. Use the New job button above to get started."
      >
        {list.kind === 'ok' && jobs.length > 0 && filtered.length === 0 && (
          <p className="muted">No jobs match these filters.</p>
        )}
        {list.kind === 'ok' && filtered.length > 0 && (
          <>
            <ul className="card-list">
              {slice.items.map((j) => (
                <li key={j.id}>
                  <JobSummaryCard job={j} />
                </li>
              ))}
            </ul>
            <Pagination
              page={slice.page}
              pageCount={slice.pageCount}
              onPageChange={goPage}
              label="Jobs pages"
              total={slice.total}
            />
          </>
        )}
      </StateBlock>

      {submitMode && (
        <Modal
          title={
            submitMode === 'local' ? 'New job — Local' : 'New job — Cluster'
          }
          onClose={() => setSubmitMode(null)}
          wide
        >
          <SubmitJobBox
            namespace={namespace}
            repo={repo}
            initialMode={submitMode}
          />
        </Modal>
      )}
    </div>
  )
}
