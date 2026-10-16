import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  cancelJob,
  fetchJobLogs,
  getJob,
  jobRunnerClass,
  jobRunnerDetail,
  jobRunnerLabel,
  jobSourceLabel,
  jobTargetLabel,
  type JobRun,
} from '../lib/jobs'
import { formatRelativeTime } from '../lib/time'

function statusClass(s: JobRun['status']) {
  if (s === 'succeeded') return 'pill ok'
  if (s === 'failed' || s === 'cancelled') return 'pill bad'
  if (s === 'running') return 'pill warn'
  return 'pill'
}

/** Single job detail (status, I/O, logs, cancel). */
export function JobPage() {
  const { namespace = '', repo = '', jobId = '' } = useParams()
  const detail = useAsync((signal) => getJob(jobId, signal), [jobId])
  const detailReload = detail.reload
  const [logs, setLogs] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetchJobLogs(jobId)
        .then((t) => {
          if (!cancelled) setLogs(typeof t === 'string' ? t : '')
        })
        .catch(() => {})
    }
    load()
    const t = setInterval(() => {
      detailReload()
      load()
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [jobId, detailReload])

  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const jobsHref = `${base}/jobs`

  if (detail.kind === 'loading') {
    return (
      <div className="page-stack">
        <StateBlock loading>{null}</StateBlock>
      </div>
    )
  }
  if (detail.kind === 'error') {
    return (
      <div className="page-stack">
        <p className="muted">
          <Link to={jobsHref}>← Jobs</Link>
        </p>
        <StateBlock error={detail.message} onRetry={() => detailReload()}>
          {null}
        </StateBlock>
      </div>
    )
  }

  const job = detail.data.job

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="muted">
          <Link to={jobsHref}>← Jobs</Link>
        </p>
        <h1>
          <span
            className={jobRunnerClass(job)}
            title={jobRunnerDetail(job)}
          >
            {jobRunnerLabel(job)}
          </span>{' '}
          <span className={statusClass(job.status)}>{job.status}</span>{' '}
          {job.name?.trim() ? (
            <>
              <span>{job.name.trim()}</span>{' '}
              <span className="mono muted small">{job.id}</span>
            </>
          ) : (
            <span className="mono">Job {job.id}</span>
          )}
        </h1>
        <p className="muted">
          Created {formatRelativeTime(job.created_at)}
          {job.started_at
            ? ` · started ${formatRelativeTime(job.started_at)}`
            : ''}
          {job.finished_at
            ? ` · finished ${formatRelativeTime(job.finished_at)}`
            : ''}
        </p>
      </header>

      <div className="jobs-detail-body">
        <dl className="jobs-meta">
          <dt>Runner</dt>
          <dd>
            <span className={jobRunnerClass(job)}>{jobRunnerLabel(job)}</span>{' '}
            <span className="muted small">
              {job.runner === 'kubernetes'
                ? 'Kubernetes'
                : job.runner === 'cli'
                  ? 'CLI'
                  : 'Docker'}
            </span>
          </dd>
          <dt>Image</dt>
          <dd className="mono">{job.image}</dd>
          {job.image_digest && (
            <>
              <dt>Digest</dt>
              <dd className="mono">{job.image_digest}</dd>
            </>
          )}
          <dt>Command</dt>
          <dd className="mono">{[...job.command, ...job.args].join(' ')}</dd>
          <dt>Source pin</dt>
          <dd className="mono">
            <Link to={`${base}/commits/${job.pin_commit}`}>
              {jobSourceLabel(job)}
            </Link>
          </dd>
          <dt>Result branch</dt>
          <dd className="mono">
            {job.result_branch ? (
              <Link
                to={`${base}/tree/${encodeURIComponent(job.result_branch)}`}
              >
                {job.result_branch}
              </Link>
            ) : (
              <span className="muted">pending</span>
            )}
          </dd>
          <dt>Synced to</dt>
          <dd className="mono">
            {jobTargetLabel(job) !== '—' ? (
              <Link
                to={`${base}/tree/${encodeURIComponent(jobTargetLabel(job))}`}
              >
                {jobTargetLabel(job)}
              </Link>
            ) : (
              <span className="muted">— (local only; use boxen job sync)</span>
            )}
          </dd>
          <dt>Result</dt>
          <dd>
            {job.result_commit ? (
              <Link
                className="mono"
                to={`${base}/commits/${job.result_commit}`}
              >
                {job.result_commit.slice(0, 12)}
              </Link>
            ) : (
              <span className="muted">—</span>
            )}
          </dd>
          <dt>Exit</dt>
          <dd>{job.exit_code ?? '—'}</dd>
          {job.error && (
            <>
              <dt>Error</dt>
              <dd>{job.error}</dd>
            </>
          )}
        </dl>

        <h2>Inputs ({job.inputs.length})</h2>
        <PathTable rows={job.inputs} />
        <h2>Outputs ({job.outputs.length})</h2>
        <PathTable rows={job.outputs} />

        {(job.status === 'queued' || job.status === 'running') && (
          <button
            type="button"
            className="btn"
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true)
              try {
                await cancelJob(job.id)
                detailReload()
              } finally {
                setCancelling(false)
              }
            }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}

        <h2>Logs</h2>
        <pre className="jobs-logs">{logs || '(empty)'}</pre>
      </div>
    </div>
  )
}

function PathTable({ rows }: { rows: { path: string; hash: string }[] }) {
  if (!rows.length) return <p className="muted">None</p>
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Path</th>
          <th>Hash</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path}>
            <td className="mono">{r.path}</td>
            <td className="mono muted">{r.hash.slice(0, 12)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
