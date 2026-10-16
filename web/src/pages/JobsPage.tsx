import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { JobSummaryCard } from '../components/JobSummaryCard'
import { Modal } from '../components/Modal'
import { PAGE_SIZE, Pagination, paginate } from '../components/Pagination'
import { StateBlock } from '../components/StateBlock'
import { SubmitJobBox } from '../components/SubmitJobBox'
import { useAsync } from '../hooks/useAsync'
import { listJobs } from '../lib/jobs'

/** Repository jobs list — detail lives on JobPage. */
export function JobsPage() {
  const { namespace = '', repo = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [submitOpen, setSubmitOpen] = useState(false)
  const pageParam = Number(params.get('page') || '1')
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  const list = useAsync(
    (signal) => listJobs({ namespace, repo, limit: 100 }, signal),
    [namespace, repo],
  )
  const listReload = list.reload
  const jobs = list.kind === 'ok' ? list.data.jobs : []
  const hasJobs = list.kind === 'ok' && jobs.length > 0
  const slice = paginate(jobs, page, PAGE_SIZE)

  useEffect(() => {
    if (!hasJobs) return
    const t = setInterval(() => listReload(), 4000)
    return () => clearInterval(t)
  }, [hasJobs, listReload])

  function goPage(next: number) {
    const nextParams = new URLSearchParams(params)
    if (next <= 1) nextParams.delete('page')
    else nextParams.set('page', String(next))
    setParams(nextParams, { replace: true })
  }

  return (
    <div className="page-stack">
      <header className="page-header page-head">
        <div>
          <h1>Jobs</h1>
          <p className="muted">
            Container jobs for this repository (Local Docker or Cluster
            Kubernetes, per{' '}
            <span className="mono">JOBS_RUNNER</span>). Submit with the CLI;
            open a job for status, logs, and results.
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setSubmitOpen(true)}
        >
          Submit job
        </button>
      </header>

      <StateBlock
        loading={list.kind === 'loading' && !jobs.length}
        error={list.kind === 'error' && !jobs.length ? list.message : null}
        onRetry={() => listReload()}
        empty={list.kind === 'ok' && jobs.length === 0}
        emptyMessage={
          <>
            <p className="muted">No jobs yet.</p>
            <button
              type="button"
              className="btn primary"
              onClick={() => setSubmitOpen(true)}
            >
              Submit job
            </button>
          </>
        }
      >
        {list.kind === 'ok' && jobs.length > 0 && (
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
            />
          </>
        )}
      </StateBlock>

      {submitOpen && (
        <Modal title="Submit job" onClose={() => setSubmitOpen(false)} wide>
          <SubmitJobBox namespace={namespace} repo={repo} />
        </Modal>
      )}
    </div>
  )
}
