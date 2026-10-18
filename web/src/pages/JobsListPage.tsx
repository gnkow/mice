import { useSearchParams } from 'react-router-dom'
import { JobSummaryCard } from '../components/JobSummaryCard'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { listJobs } from '../lib/jobs'

export function JobsListPage() {
  const state = useAsync((signal) => listJobs({ limit: 100 }, signal), [])
  const [params, setParams] = useSearchParams()
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
  const jobs = state.kind === 'ok' ? state.data.jobs : []
  const slice = paginate(jobs, page, PAGE_SIZE)

  function goPage(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next <= 1) nextParams.delete('page')
    else nextParams.set('page', String(next))
    setParams(nextParams, { replace: true })
  }

  return (
    <main className="page wide">
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="muted">
            Jobs across repositories you can access — each run is tagged{' '}
            <span className="pill runner-local">Local</span> (CLI, after{' '}
            <span className="mono">boxen push</span>) or{' '}
            <span className="pill runner-cluster">Cluster</span>. Open a job for
            logs and results.
          </p>
        </div>
      </div>

      <StateBlock
        loading={state.kind === 'loading'}
        error={state.kind === 'error' ? state.message : null}
        onRetry={() => state.reload()}
        empty={state.kind === 'ok' && jobs.length === 0}
        emptyMessage={
          <>
            No jobs yet. For local runs: <span className="mono">boxen job run</span>{' '}
            then <span className="mono">boxen push</span>.
          </>
        }
      >
        {state.kind === 'ok' && (
          <>
            <ul className="card-list">
              {slice.items.map((j) => (
                <li key={j.id}>
                  <JobSummaryCard job={j} showRepo />
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
