import { Link } from 'react-router-dom'
import {
  jobCommandLabel,
  jobImageLabel,
  jobOutcomeRefLabel,
  jobRunnerClass,
  jobRunnerDetail,
  jobRunnerLabel,
  jobSourceLabel,
  shortenJobRef,
  type JobRun,
} from '../lib/jobs'
import { StatusPill } from './StatusPill'
import { MetaPills } from './MetaPills'
import { formatRelativeTime } from '../lib/time'

type Props = {
  job: JobRun
  /** When true, show namespace/repo in the footer (global jobs list). */
  showRepo?: boolean
}

/** Shared job row for repo Jobs and global Jobs list. */
export function JobSummaryCard({ job, showRepo }: Props) {
  const href = `/n/${encodeURIComponent(job.namespace)}/r/${encodeURIComponent(job.repo)}/jobs/${encodeURIComponent(job.id)}`
  const title = (job.name || '').trim() || job.id
  const hasName = Boolean(job.name?.trim())
  const sourceFull = jobSourceLabel(job)
  const resultFull = jobOutcomeRefLabel(job)
  const image = jobImageLabel(job)
  const command = jobCommandLabel(job)
  const actor =
    job.actor?.name?.trim() ||
    job.actor?.email?.trim() ||
    ''

  const metaParts = [image, command].filter(Boolean)

  return (
    <Link className="repo-summary-card jobs-list-card" to={href}>
      <span className="jobs-card-body">
        <span className="jobs-card-top">
          <span className="jobs-card-heading">
            <span className="jobs-card-name" title={title}>
              {title}
            </span>
            {hasName ? (
              <span className="jobs-card-id mono muted" title={job.id}>
                {job.id.slice(0, 10)}
              </span>
            ) : null}
          </span>
          <span className="jobs-card-tags">
            <span
              className={jobRunnerClass(job)}
              title={jobRunnerDetail(job)}
            >
              {jobRunnerLabel(job)}
            </span>
            <StatusPill status={job.status} />
          </span>
        </span>

        {metaParts.length > 0 ? (
          <span className="jobs-card-meta mono muted" title={metaParts.join(' · ')}>
            {metaParts.join(' · ')}
          </span>
        ) : null}

        <span className="jobs-card-refs">
          <span className="jobs-ref">
            <span className="jobs-ref-label">Source</span>
            <span className="mono" title={sourceFull}>
              {shortenJobRef(sourceFull)}
            </span>
          </span>
          <span className="jobs-ref-arrow" aria-hidden>
            →
          </span>
          <span className="jobs-ref">
            <span className="jobs-ref-label">Result</span>
            <span className="mono" title={resultFull}>
              {shortenJobRef(resultFull)}
            </span>
          </span>
        </span>

        <MetaPills type="job" id={job.id} />

        <span className="jobs-card-footer muted">
          {showRepo ? (
            <span className="jobs-card-repo">
              {job.namespace}/{job.repo}
            </span>
          ) : null}
          <span>{formatRelativeTime(job.created_at)}</span>
          {actor ? <span className="jobs-card-actor">{actor}</span> : null}
          {job.exit_code != null && job.status !== 'running' ? (
            <span
              className="jobs-card-exit mono"
              title={`Exit code ${job.exit_code}`}
            >
              exit {job.exit_code}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  )
}
