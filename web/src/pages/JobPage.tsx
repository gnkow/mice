import { ClipboardList, Files, Terminal, Tags, X as ActionX, type LucideIcon } from 'lucide-react'
import { MetaBody } from '../components/MetaPanel'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import {
  cancelJob,
  fetchJobLogs,
  getJob,
  jobCommandLabel,
  jobOutcomeRefLabel,
  jobRunnerClass,
  jobRunnerDetail,
  jobRunnerLabel,
  jobSourceLabel,
  jobTargetLabel,
  shortenJobRef,
  type JobRun,
} from '../lib/jobs'
import { formatRelativeTime } from '../lib/time'

type JobTab = 'overview' | 'files' | 'logs' | 'metadata'

const TABS: { id: JobTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'metadata', label: 'Metadata', icon: Tags },
]

function statusClass(s: JobRun['status']) {
  if (s === 'succeeded') return 'pill ok'
  if (s === 'failed' || s === 'cancelled') return 'pill bad'
  if (s === 'running') return 'pill warn'
  return 'pill'
}

function runnerBackend(job: JobRun): string {
  if (job.runner === 'kubernetes') return 'Kubernetes'
  if (job.runner === 'cli') return 'CLI'
  return 'Docker'
}

/** Single job detail (status, I/O, logs, cancel). */
export function JobPage() {
  const { namespace = '', repo = '', jobId = '' } = useParams()
  const detail = useAsync((signal) => getJob(jobId, signal), [jobId])
  const detailReload = detail.reload
  const [logs, setLogs] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [tab, setTab] = useState<JobTab>('overview')

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
  const title = job.name?.trim() || `Job ${job.id.slice(0, 10)}`
  const hasName = Boolean(job.name?.trim())
  const sourceFull = jobSourceLabel(job)
  const resultFull = jobOutcomeRefLabel(job)
  const syncTo = jobTargetLabel(job)
  const command = jobCommandLabel(job, 120)
  const canCancel = job.status === 'queued' || job.status === 'running'
  const actor =
    job.actor?.name?.trim() || job.actor?.email?.trim() || ''

  async function onCancel() {
    setCancelling(true)
    try {
      await cancelJob(job.id)
      detailReload()
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="page-stack job-page">
      <header className="job-page-head">
        <p className="muted small">
          <Link to={jobsHref}>← Jobs</Link>
        </p>

        <div className="job-page-title-row">
          <div className="job-page-title-main">
            <h1 className="job-page-title">{title}</h1>
            {hasName ? (
              <span className="job-page-id mono muted" title={job.id}>
                {job.id.slice(0, 12)}
              </span>
            ) : null}
            <span className="job-page-tags">
              <span
                className={jobRunnerClass(job)}
                title={jobRunnerDetail(job)}
              >
                {jobRunnerLabel(job)}
              </span>
              <span className={statusClass(job.status)}>{job.status}</span>
            </span>
          </div>
          {canCancel ? (
            <button
              type="button"
              className="btn"
              disabled={cancelling}
              onClick={() => void onCancel()}
            >
              <ActionX size={14} aria-hidden="true" className="button-label-icon" />{cancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          ) : null}
        </div>

        <p className="job-page-byline muted small">
          {job.finished_at
            ? `Finished ${formatRelativeTime(job.finished_at)}`
            : job.started_at
              ? `Started ${formatRelativeTime(job.started_at)}`
              : `Created ${formatRelativeTime(job.created_at)}`}
          {actor ? ` · ${actor}` : ''}
          {job.exit_code != null && job.status !== 'running'
            ? ` · exit ${job.exit_code}`
            : ''}
        </p>
      </header>

      {job.error ? (
        <p className="flash flash-error job-page-error" role="status">
          {job.error}
        </p>
      ) : null}

      <section className="job-page-summary" aria-label="Run summary">
        <p className="job-page-cmd mono" title={[job.image, command].filter(Boolean).join(' · ')}>
          <span className="job-page-cmd-image">{job.image || '—'}</span>
          {command ? (
            <>
              <span className="job-page-cmd-sep" aria-hidden>
                ·
              </span>
              <span>{command}</span>
            </>
          ) : null}
        </p>
        <div className="jobs-card-refs job-page-refs">
          <span className="jobs-ref">
            <span className="jobs-ref-label">Source</span>
            {job.pin_commit ? (
              <Link
                className="mono"
                to={`${base}/commits/${encodeURIComponent(job.pin_commit)}`}
                title={sourceFull}
              >
                {shortenJobRef(sourceFull)}
              </Link>
            ) : (
              <span className="mono" title={sourceFull}>
                {shortenJobRef(sourceFull)}
              </span>
            )}
          </span>
          <span className="jobs-ref-arrow" aria-hidden>
            →
          </span>
          <span className="jobs-ref">
            <span className="jobs-ref-label">Result</span>
            {job.result_commit ? (
              <Link
                className="mono"
                to={`${base}/commits/${encodeURIComponent(job.result_commit)}`}
                title={resultFull}
              >
                {shortenJobRef(resultFull)}
              </Link>
            ) : (
              <span className="mono muted" title={resultFull}>
                {shortenJobRef(resultFull)}
              </span>
            )}
          </span>
        </div>
      </section>

      <div className="tab-bar" role="tablist" aria-label="Job views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`job-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`job-panel-${t.id}`}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={14} aria-hidden="true" className="button-label-icon" />{t.label}
            {t.id === 'files'
              ? ` (${job.inputs.length + job.outputs.length})`
              : ''}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <section
          className="job-page-panel"
          role="tabpanel"
          id="job-panel-overview"
          aria-labelledby="job-tab-overview"
        >
          <dl className="jobs-meta job-page-meta">
            <dt>Runner</dt>
            <dd>
              <span className={jobRunnerClass(job)}>{jobRunnerLabel(job)}</span>{' '}
              <span className="muted small">{runnerBackend(job)}</span>
            </dd>
            <dt>Synced to</dt>
            <dd className="mono">
              {syncTo !== '—' ? (
                <Link to={`${base}/tree/${encodeURIComponent(syncTo)}`}>
                  {syncTo}
                </Link>
              ) : (
                <span className="muted">
                  Not published — push with <span className="mono">mice push</span>
                </span>
              )}
            </dd>
            {job.result_branch ? (
              <>
                <dt>Result branch</dt>
                <dd className="mono">
                  <Link
                    to={`${base}/tree/${encodeURIComponent(job.result_branch)}`}
                  >
                    {job.result_branch}
                  </Link>
                </dd>
              </>
            ) : null}
            <dt>Exit</dt>
            <dd>{job.exit_code ?? '—'}</dd>
          </dl>

          <details className="job-page-more">
            <summary>More details</summary>
            <dl className="jobs-meta job-page-meta">
              {job.image_digest ? (
                <>
                  <dt>Digest</dt>
                  <dd className="mono">{job.image_digest}</dd>
                </>
              ) : null}
              <dt>Workdir</dt>
              <dd className="mono">{job.workdir || '—'}</dd>
              <dt>Network</dt>
              <dd className="mono">{job.network || '—'}</dd>
              <dt>Timeout</dt>
              <dd>
                {job.timeout_seconds
                  ? `${job.timeout_seconds}s`
                  : '—'}
              </dd>
              <dt>Resources</dt>
              <dd className="mono">
                cpu {job.resources?.cpu || '—'} · mem{' '}
                {job.resources?.memory || '—'} · disk{' '}
                {job.resources?.disk || '—'}
              </dd>
              {job.input_globs?.length ? (
                <>
                  <dt>Input globs</dt>
                  <dd className="mono">{job.input_globs.join(', ')}</dd>
                </>
              ) : null}
              {Object.keys(job.env || {}).length > 0 ? (
                <>
                  <dt>Env</dt>
                  <dd className="mono">
                    {Object.keys(job.env)
                      .sort()
                      .join(', ')}
                  </dd>
                </>
              ) : null}
            </dl>
          </details>
        </section>
      )}

      {tab === 'files' && (
        <section
          className="job-page-panel"
          role="tabpanel"
          id="job-panel-files"
          aria-labelledby="job-tab-files"
        >
          <h2 className="job-page-section-label">
            Inputs ({job.inputs.length})
          </h2>
          <PathTable rows={job.inputs} />
          <h2 className="job-page-section-label">
            Outputs ({job.outputs.length})
          </h2>
          <PathTable rows={job.outputs} />
        </section>
      )}

      {tab === 'logs' && (
        <section
          className="job-page-panel"
          role="tabpanel"
          id="job-panel-logs"
          aria-labelledby="job-tab-logs"
        >
          <pre className="jobs-logs">{logs || '(empty)'}</pre>
        </section>
      )}

      {tab === 'metadata' && (
        <section
          className="job-page-panel"
          role="tabpanel"
          id="job-panel-metadata"
          aria-labelledby="job-tab-metadata"
        >
          <h2 className="job-page-section-label">Metadata</h2>
          <MetaBody type="job" id={job.id} />
        </section>
      )}
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
