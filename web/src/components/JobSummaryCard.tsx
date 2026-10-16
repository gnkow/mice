import { Link } from 'react-router-dom'
import {
  jobOutcomeRefLabel,
  jobRunnerClass,
  jobRunnerDetail,
  jobRunnerLabel,
  jobSourceLabel,
  type JobRun,
} from '../lib/jobs'
import { formatRelativeTime } from '../lib/time'

function statusClass(s: JobRun['status']) {
  if (s === 'succeeded') return 'pill ok'
  if (s === 'failed' || s === 'cancelled') return 'pill bad'
  if (s === 'running') return 'pill warn'
  return 'pill'
}

type Props = {
  job: JobRun
  /** When true, show namespace/repo in the footer (global jobs list). */
  showRepo?: boolean
}

/** Shared job row for repo Jobs and global Jobs list. */
export function JobSummaryCard({ job, showRepo }: Props) {
  const href = `/n/${encodeURIComponent(job.namespace)}/r/${encodeURIComponent(job.repo)}/jobs/${encodeURIComponent(job.id)}`
  const title = (job.name || '').trim() || job.id

  return (
    <Link className="repo-summary-card jobs-list-card" to={href}>
      <span className="repo-summary-main">
        <span className="card-title jobs-card-title">
          <span className="jobs-card-name" title={title}>
            {title}
          </span>
          {job.name?.trim() ? (
            <span className="mono muted small" title={job.id}>
              {job.id.slice(0, 10)}
            </span>
          ) : null}
          <span
            className={jobRunnerClass(job)}
            title={jobRunnerDetail(job)}
          >
            {jobRunnerLabel(job)}
          </span>
          <span className={statusClass(job.status)}>{job.status}</span>
        </span>
        <span className="card-meta jobs-card-refs">
          <span>
            <span className="jobs-ref-label">source</span>{' '}
            <span className="mono" title={jobSourceLabel(job)}>
              {jobSourceLabel(job)}
            </span>
          </span>
          <span className="jobs-ref-arrow" aria-hidden>
            →
          </span>
          <span>
            <span className="jobs-ref-label">result</span>{' '}
            <span className="mono" title={jobOutcomeRefLabel(job)}>
              {jobOutcomeRefLabel(job)}
            </span>
          </span>
        </span>
        <span className="card-meta muted jobs-card-footer">
          {showRepo ? (
            <>
              <span>
                {job.namespace}/{job.repo}
              </span>
              <span aria-hidden> · </span>
            </>
          ) : null}
          <span>{formatRelativeTime(job.created_at)}</span>
        </span>
      </span>
    </Link>
  )
}
