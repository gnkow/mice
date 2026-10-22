import { Trash2 as ActionTrash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { JobSummaryCard } from '../components/JobSummaryCard'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { listJobs } from '../lib/jobs'
import { FavoriteStar } from '../components/FavoriteStar'
import { SortControl, useListSort, type SortFields } from '../components/SortControl'
import { useFavorites } from '../lib/favorites'
import type { JobRun } from '../lib/jobs'

const JOBS_SORTS: SortFields<JobRun> = { name: (x) => x.name || x.id, created: (x) => x.created_at }

export function JobsListPage() {
  const state = useAsync((signal) => listJobs({ limit: 100, favoritesFirst: true }, signal), [])
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState(params.get('q') ?? '')
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const jobs = state.kind === 'ok' ? state.data.jobs : []

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter((job) => {
      const repo = `${job.namespace}/${job.repo}`
      return job.name.toLowerCase().includes(q) ||
             repo.toLowerCase().includes(q) ||
             job.runner.toLowerCase().includes(q) ||
             job.status.toLowerCase().includes(q)
    })
  }, [jobs, filter])

  const sort = useListSort('jobs', JOBS_SORTS)
  const favs = useFavorites()
  const ordered = useMemo(
    () => sort.apply(filtered, (x) => favs.has('job', x.id)),
    [filtered, sort.apply, favs],
  )
  const slice = paginate(ordered, page, PAGE_SIZE)

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

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="lede">
            Run computational tasks on your data across all repositories — execute locally or remotely on the server. View status, logs, and results for each job.
          </p>
        </div>
      </div>

      <div className="ns-toolbar">
        <SortControl id="jobs" sort={sort} />
        <div className="ns-search-field">
          <label className="ns-search-label" htmlFor="job-filter">
            Search
          </label>
          <div className="ns-search-control">
            <span className="ns-search-icon" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M10.5 10.5L14 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              id="job-filter"
              type="search"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Filter by name, repository, runner, or status"
              autoComplete="off"
            />
            {filter.trim() ? (
              <button
                type="button"
                className="ns-search-clear"
                onClick={() => onFilterChange('')}
                aria-label="Clear search"
              >
                <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Clear
              </button>
            ) : null}
          </div>
        </div>
        {state.kind === 'ok' && (
          <p className="muted small ns-toolbar-meta">
            {filtered.length} job{filtered.length === 1 ? '' : 's'}
            {filter.trim() ? ' matching' : ''}
          </p>
        )}
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && filtered.length === 0}
        emptyMessage={
          filter.trim()
            ? `No jobs match "${filter.trim()}".`
            : "No jobs yet. Use the command-line tools to create and submit jobs."
        }
      >
        {state.kind === 'ok' && (
          <>
            <ul className="card-list">
              {slice.items.map((j) => (
                <li key={j.id} className="fav-row">
                  <JobSummaryCard job={j} showRepo />
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
    </main>
  )
}
