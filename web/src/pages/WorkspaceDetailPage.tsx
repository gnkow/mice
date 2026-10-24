import { StatusPill } from '../components/StatusPill'
import { useEffect, useState } from 'react'
import { FileDiff, Monitor, Terminal, X as ActionX, type LucideIcon } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { formatBytes } from '../lib/oxen/client'
import { formatRelativeTime } from '../lib/time'
import { SessionRowActions, useMaySessionConnect } from '../components/SessionRowActions'
import { SessionSummaryCard } from '../components/SessionSummaryCard'
import { listSessions } from '../lib/sessions'
import { getMiceWorkspace, getMiceWorkspaceChanges, releaseWorkspaceLease } from '../lib/workspaces'

type Tab = 'changes' | 'jobs' | 'sessions'

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'changes', label: 'Changes', icon: FileDiff },
  { id: 'jobs', label: 'Jobs', icon: Terminal },
  { id: 'sessions', label: 'Sessions', icon: Monitor },
]

export function WorkspaceDetailPage() {
  const [params] = useSearchParams()
  const initialTab = params.get('tab')
  const [tab, setTab] = useState<Tab>(initialTab === 'jobs' || initialTab === 'sessions' ? initialTab : 'changes')
  const { namespace = '', repo = '', workspaceId = '' } = useParams()
  const mayConnect = useMaySessionConnect()
  const detail = useAsync((signal) => getMiceWorkspace(workspaceId, signal), [workspaceId])
  const ws = detail.kind === 'ok' ? detail.data.workspace : null
  const ready = ws?.status === 'ready'
  const changes = useAsync(
    (signal) => (ready ? getMiceWorkspaceChanges(workspaceId, signal) : Promise.resolve(null)),
    [workspaceId, ready],
  )
  const sessions = useAsync((signal) => listSessions(signal, { workspace_id: workspaceId }), [workspaceId])
  const reload = detail.reload
  useEffect(() => {
    if (ws?.status !== 'preparing') return
    const t = setInterval(() => reload(), 2000)
    return () => clearInterval(t)
  }, [ws?.status, reload])

  const [leaseError, setLeaseError] = useState<string | null>(null)
  async function onRelease(leaseId: string) {
    setLeaseError(null)
    try {
      await releaseWorkspaceLease(workspaceId, leaseId)
      reload()
    } catch (err) {
      setLeaseError(err instanceof Error ? err.message : 'Release failed')
    }
  }

  const base = `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`
  const c = changes.kind === 'ok' ? changes.data : null

  const title = ws ? ws.name || ws.id : 'Workspace'

  return (
    <div className="page-stack job-page">
      <StateBlock
        loading={detail.kind === 'loading'}
        error={detail.kind === 'error' ? detail.message : null}
        onRetry={() => detail.reload()}
      >
        {ws && (
          <>
            <header className="job-page-head">
              <p className="muted small">
                <Link to={`${base}/workspaces`}>← Workspaces</Link>
              </p>
              <div className="job-page-title-row">
                <div className="job-page-title-main">
                  <h1 className="job-page-title">{title}</h1>
                  {ws.name ? (
                    <span className="job-page-id mono muted" title={ws.id}>{ws.id}</span>
                  ) : null}
                  <span className="job-page-tags">
                    <span className="pill">{ws.driver}</span>
                    <StatusPill status={ws.status} />
                  </span>
                </div>
              </div>
              <p className="job-page-byline muted small">
                Created {formatRelativeTime(ws.created_at)} · {ws.created_by}
              </p>
            </header>

            {ws.last_error ? (
              <p className="flash flash-error job-page-error" role="status">{ws.last_error}</p>
            ) : null}

            <section className="job-page-summary" aria-label="Workspace summary">
              <div className="jobs-card-refs job-page-refs">
                <span className="jobs-ref">
                  <span className="jobs-ref-label">Repository</span>
                  <Link to={base}>{ws.namespace}/{ws.repo}</Link>
                </span>
                {ws.branch ? (
                  <>
                    <span className="jobs-ref-arrow" aria-hidden>→</span>
                    <span className="jobs-ref">
                      <span className="jobs-ref-label">Branch</span>
                      <span className="mono">{ws.branch}</span>
                    </span>
                  </>
                ) : null}
                {ws.base_commit ? (
                  <span className="jobs-ref">
                    <span className="jobs-ref-label">Base</span>
                    <Link className="mono" to={`${base}/commits/${encodeURIComponent(ws.base_commit)}`}>
                      {ws.base_commit.slice(0, 8)}
                    </Link>
                    {ws.behind ? <span className="pill warn"> behind</span> : null}
                  </span>
                ) : null}
              </div>
              {ws.leases && ws.leases.length > 0 ? (
                <ul className="plain-list small" aria-label="Leases">
                  {ws.leases.map((l) => (
                    <li key={l.id}>
                      <span className={l.mode === 'write' ? 'pill warn' : 'pill'}>{l.mode === 'write' ? 'writer' : 'reader'}</span>{' '}
                      {l.holder.label || `${l.holder.kind} ${l.holder.id}`}
                      <span className="muted"> · {l.holder.user ?? ''} · expires {formatRelativeTime(l.expires_at)}</span>{' '}
                      <button type="button" className="btn ghost small" onClick={() => void onRelease(l.id)}>
                        <ActionX size={12} aria-hidden="true" className="button-label-icon" />Release
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {leaseError ? <p className="error small">{leaseError}</p> : null}
              <p className="job-page-cmd mono">
                {ws.change_counts.added + ws.change_counts.modified + ws.change_counts.removed === 0
                  ? 'No changes'
                  : `+${ws.change_counts.added} ~${ws.change_counts.modified} −${ws.change_counts.removed}`}
                <span className="job-page-cmd-sep" aria-hidden>·</span>
                {formatBytes(ws.upper_bytes)}
              </p>
            </section>

            <div className="tab-bar" role="tablist" aria-label="Workspace views">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`ws-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`ws-panel-${t.id}`}
                  className={tab === t.id ? 'active' : ''}
                  onClick={() => setTab(t.id)}
                >
                  <t.icon size={14} aria-hidden="true" className="button-label-icon" />{t.label}
                </button>
              ))}
            </div>
            <section className="job-page-panel" role="tabpanel" id={`ws-panel-${tab}`} aria-labelledby={`ws-tab-${tab}`}>
              {tab === 'changes' && (
                <>
                  {!ready ? (
                    <p className="muted">Changes are available once the workspace is ready.</p>
                  ) : changes.kind === 'loading' ? (
                    <p className="muted">Scanning…</p>
                  ) : changes.kind === 'error' ? (
                    <p className="error">{changes.message}</p>
                  ) : c && c.added.length + c.modified.length + c.removed.length === 0 ? (
                    <p className="muted">No changes.</p>
                  ) : (
                    c && (
                      <ul className="plain-list mono small">
                        {c.added.map((f) => <li key={`a${f.path}`}>+ {f.path} <span className="muted">{formatBytes(f.size)}</span></li>)}
                        {c.modified.map((f) => <li key={`m${f.path}`}>~ {f.path} <span className="muted">{formatBytes(f.size)}</span></li>)}
                        {c.removed.map((f) => <li key={`r${f.path}`}>− {f.path}</li>)}
                      </ul>
                    )
                  )}
                </>
              )}
              {tab === 'jobs' && (
                <p className="muted">No jobs have used this workspace yet. Mounting workspaces into jobs is not available yet.</p>
              )}
              {tab === 'sessions' && (
                <StateBlock
                  loading={sessions.kind === 'loading'}
                  error={sessions.kind === 'error' ? sessions.message : null}
                  onRetry={() => sessions.reload()}
                  empty={sessions.kind === 'ok' && sessions.data.sessions.length === 0}
                  emptyMessage="No sessions have mounted this workspace."
                >
                  <ul className="card-list">
                    {sessions.kind === 'ok' &&
                      sessions.data.sessions.map((s) => (
                        <li key={s.id} className="fav-row session-row">
                          <SessionSummaryCard session={s} />
                          <SessionRowActions session={s} mayConnect={mayConnect} onChanged={() => sessions.reload()} />
                        </li>
                      ))}
                  </ul>
                </StateBlock>
              )}
            </section>
          </>
        )}
      </StateBlock>
    </div>
  )
}
