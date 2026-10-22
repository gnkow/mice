import { Laptop as ActionLaptop, Server as ActionServer, Terminal as ActionTerminal, Trash2 as ActionTrash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { FavoriteStar } from '../components/FavoriteStar'
import { JobSummaryCard } from '../components/JobSummaryCard'
import { ListToolbar } from '../components/ListToolbar'
import { useListSort, type SortFields } from '../components/SortControl'
import { useFavorites } from '../lib/favorites'
import { Modal } from '../components/Modal'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { SubmitJobBox } from '../components/SubmitJobBox'
import { useAsync } from '../hooks/useAsync'
import {
  JOB_STATUSES,
  collectJobBranches,
  filterAndSortJobs,
  listJobs,
  parseJobRunner,
  parseJobStatus,
  type JobRun,
  type JobRunnerKind,
  type JobStatus,
} from '../lib/jobs'

const JOB_SORT_FIELDS: SortFields<JobRun> = { name: (j) => j.name || j.id, created: (j) => j.created_at }

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
  const listSort = useListSort('repo-jobs', JOB_SORT_FIELDS)
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
    sort: 'created_desc',
  })
  const favs = useFavorites()
  const ordered = useMemo(
    () => listSort.apply(filtered, (j) => favs.has('job', j.id)),
    [filtered, listSort.apply, favs],
  )
  const slice = paginate(ordered, page, PAGE_SIZE)
  const filtersActive = Boolean(
    status ||
      runner ||
      sourceBranch ||
      targetBranch ||
      q.trim(),
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
            Run computational tasks on your data — execute locally on your computer or remotely on the server. View status, logs, and results for each job.
          </p>
        </div>
        <div className="btn-row">
          <details className="clone-dropdown submit-job-dropdown">
            <summary className="btn primary"><ActionTerminal size={14} aria-hidden="true" className="button-label-icon" />New job</summary>
            <div className="clone-dropdown-panel submit-job-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="submit-job-option"
                onClick={(e) => openSubmit('local', e)}
              >
                <ActionLaptop size={14} aria-hidden="true" className="button-label-icon" /><span className="pill runner-local">Local</span>
                <span className="submit-job-option-text">
                  <b>Run on your machine</b>
                  <span className="muted small">
                    Execute locally using your local data
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="submit-job-option"
                onClick={(e) => openSubmit('cluster', e)}
              >
                <ActionServer size={14} aria-hidden="true" className="button-label-icon" /><span className="pill runner-cluster">Cluster</span>
                <span className="submit-job-option-text">
                  <b>Run on the server</b>
                  <span className="muted small">
                    Submit to the server job queue
                  </span>
                </span>
              </button>
            </div>
          </details>
        </div>
      </header>

      {hasJobs && (
        <ListToolbar
          id="jobs"
          sort={listSort}
          search={{ value: qDraft, onChange: setQDraft, onCommit: commitSearch, placeholder: 'Name, id, image, command…' }}
        >
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
                <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
              </button>
            )}
          </div>
        </ListToolbar>
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
                <li key={j.id} className="fav-row">
                  <JobSummaryCard job={j} />
                  <FavoriteStar type="job" id={j.id} label={j.name} className="fav-row-star" />
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
