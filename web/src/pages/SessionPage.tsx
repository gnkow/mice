import { Plug as ActionPlug, RefreshCw as ActionRefreshCw, Square as ActionSquare, Trash2 as ActionTrash2 } from 'lucide-react'
import { MetaBody } from '../components/MetaPanel'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe } from '../lib/auth'
import { loadCatalog } from '../lib/catalog'
import { confirmDelete } from '../lib/confirmDelete'
import {
  connectSession,
  destroySession,
  getSession,
  retrySession,
  sessionImageLabel,
  sessionMounts,
  sessionStatusClass,
  sessionTitle,
  shortenSessionId,
  statusLabel,
  stopSession,
  type DesktopSession,
} from '../lib/sessions'
import { formatRelativeTime } from '../lib/time'

export function SessionPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  const catalog = useAsync((signal) => loadCatalog(signal), [])
  const [session, setSession] = useState<DesktopSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mayConnect =
    authz.kind === 'ok' &&
    !!authz.data &&
    (!authz.data.enforce ||
      authz.data.instanceAdmin ||
      authz.data.permissions.session_connect ||
      authz.data.permissions.session_admin)

  const workspacesMap = useMemo(() => {
    if (catalog.kind !== 'ok') return new Map()
    const map = new Map<string, string>() // key: "namespace/repo/id" -> name
    for (const ws of catalog.data.workspaces) {
      map.set(`${ws.namespace}/${ws.repo}/${ws.id}`, ws.name)
    }
    return map
  }, [catalog])

  const reload = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const { session: s } = await getSession(sessionId)
      setSession(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!session || session.status !== 'provisioning') return
    const t = setInterval(() => void reload(), 2000)
    return () => clearInterval(t)
  }, [session?.status, reload])

  async function onConnect() {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    const tab = window.open('about:blank', '_blank')
    try {
      const result = await connectSession(sessionId)
      if (tab && !tab.closed) {
        tab.location.href = result.connect.client_url
      } else {
        window.location.assign(result.connect.client_url)
        return
      }
      await reload()
    } catch (err) {
      try {
        tab?.close()
      } catch {
        /* ignore */
      }
      setError(err instanceof Error ? err.message : 'Connect failed')
    } finally {
      setBusy(false)
    }
  }

  async function onStop() {
    if (!sessionId) return
    setBusy(true)
    try {
      await stopSession(sessionId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stop failed')
    } finally {
      setBusy(false)
    }
  }

  async function onDestroy() {
    if (!sessionId || !session) return
    const ok = await confirmDelete({
      title: 'Destroy this session?',
      detail:
        'The desktop container will be removed. This cannot be undone from the UI.',
      requireTypedConfirm: false,
    })
    if (!ok) return
    setBusy(true)
    try {
      await destroySession(sessionId)
      navigate('/sessions')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Destroy failed')
      setBusy(false)
    }
  }

  async function onRetry() {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    try {
      await retrySession(sessionId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !session) {
    return (
      <main className="page">
        <StateBlock loading>{null}</StateBlock>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="page">
        <p className="muted small">
          <Link to="/sessions">← Sessions</Link>
        </p>
        <StateBlock
          error={error || 'Session not found.'}
          onRetry={() => void reload()}
        >
          {null}
        </StateBlock>
      </main>
    )
  }

  const title = sessionTitle(session)
  const image = sessionImageLabel(session)
  const mounts = sessionMounts(session)
  const workspaceMounts = mounts.filter((m) => m.workspace_id)
  const canConnect =
    mayConnect &&
    (session.status === 'ready' || session.status === 'connected')
  const canRetry =
    session.status === 'failed' || session.status === 'stopped'
  const canStop =
    session.status === 'ready' ||
    session.status === 'connected' ||
    session.status === 'provisioning'
  const byline = session.ready_at
    ? `Ready ${formatRelativeTime(session.ready_at)}`
    : `Created ${formatRelativeTime(session.created_at)}`

  return (
    <main className="page session-page">
      <header className="job-page-head">
        <p className="muted small">
          <Link to="/sessions">← Sessions</Link>
        </p>

        <div className="job-page-title-row">
          <div className="job-page-title-main">
            <h1 className="job-page-title">{title}</h1>
            <span className="job-page-id mono muted" title={session.id}>
              {shortenSessionId(session.id, 12)}
            </span>
            <span className="job-page-tags">
              <span className="pill">{session.provisioner}</span>
              <span className={sessionStatusClass(session.status)}>
                {statusLabel(session.status)}
              </span>
            </span>
          </div>
          <div className="session-page-actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !canConnect}
              title={
                !mayConnect
                  ? 'Requires session_connect instance permission'
                  : undefined
              }
              onClick={() => void onConnect()}
            >
              <ActionPlug size={14} aria-hidden="true" className="button-label-icon" />Connect
            </button>
            {canRetry ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void onRetry()}
              >
                <ActionRefreshCw size={14} aria-hidden="true" className="button-label-icon" />Retry
              </button>
            ) : null}
            {canStop ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void onStop()}
              >
                <ActionSquare size={14} aria-hidden="true" className="button-label-icon" />Stop
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={busy || session.status === 'destroyed'}
              onClick={() => void onDestroy()}
            >
              <ActionTrash2 size={14} aria-hidden="true" className="button-label-icon" />Destroy
            </button>
          </div>
        </div>

        <p className="job-page-byline muted small">
          {byline}
          {session.guest_user ? ` · ${session.guest_user}` : ''}
          {session.recording ? ' · recording' : ''}
        </p>
      </header>

      {error ? (
        <p className="flash flash-error job-page-error" role="status">
          {error}
        </p>
      ) : null}
      {session.error ? (
        <p className="flash flash-error job-page-error" role="status">
          {session.error}
        </p>
      ) : null}

      <section className="job-page-summary" aria-label="Session summary">
        <p
          className="job-page-cmd mono"
          title={session.image}
        >
          <span className="job-page-cmd-image">{image || session.image}</span>
          {session.resources ? (
            <>
              <span className="job-page-cmd-sep" aria-hidden>
                ·
              </span>
              <span>
                cpu {session.resources.cpu} · mem {session.resources.memory}
              </span>
            </>
          ) : null}
        </p>
        <div className="jobs-card-refs job-page-refs">
          <span className="jobs-ref">
            <span className="jobs-ref-label">Workspaces</span>
            {workspaceMounts.length === 0 ? (
              <span className="muted">None</span>
            ) : (
              <span className="mono">
                {workspaceMounts.length} workspace{workspaceMounts.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
          {session.endpoints?.container_name ? (
            <>
              <span className="jobs-ref-arrow" aria-hidden>
                ·
              </span>
              <span className="jobs-ref">
                <span className="jobs-ref-label">Container</span>
                <span className="mono" title={session.endpoints.container_name}>
                  {session.endpoints.container_name}
                </span>
              </span>
            </>
          ) : null}
        </div>
        {workspaceMounts.length > 0 ? (
          <ul className="sessions-detail-mounts mono small">
            {workspaceMounts.map((m) => {
              const wsKey = `${m.namespace}/${m.repo}/${m.workspace_id || ''}`
              const wsName = workspacesMap.get(wsKey) || m.workspace_id?.slice(0, 8) || 'unknown'
              return (
                <li key={m.mount_path}>
                  <Link
                    to={`/n/${encodeURIComponent(m.namespace)}/r/${encodeURIComponent(m.repo)}/workspaces/${encodeURIComponent(m.workspace_id || '')}`}
                    className="session-workspace-link"
                  >
                    {m.namespace}/{m.repo} · {wsName}
                  </Link>
                  <span className="muted small">
                    {' '}
                    ({m.mount_mode} at {m.mount_path})
                  </span>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section className="job-page-panel" aria-label="Session details">
        <dl className="jobs-meta job-page-meta">
          <dt>Status</dt>
          <dd>
            <span className={sessionStatusClass(session.status)}>
              {statusLabel(session.status)}
            </span>
          </dd>
          <dt>Guest user</dt>
          <dd className="mono">{session.guest_user}</dd>
          <dt>Provisioner</dt>
          <dd>{session.provisioner}</dd>
          {session.template_id ? (
            <>
              <dt>Template</dt>
              <dd className="mono">{session.template_id}</dd>
            </>
          ) : null}
        </dl>

        <details className="job-page-more">
          <summary>More details</summary>
          <dl className="jobs-meta job-page-meta">
            <dt>Session id</dt>
            <dd className="mono">{session.id}</dd>
            <dt>Image</dt>
            <dd className="mono">{session.image}</dd>
            {session.image_digest ? (
              <>
                <dt>Digest</dt>
                <dd className="mono">{session.image_digest}</dd>
              </>
            ) : null}
            <dt>Resources</dt>
            <dd className="mono">
              cpu {session.resources.cpu} · mem {session.resources.memory} ·
              disk {session.resources.disk}
            </dd>
            <dt>Created</dt>
            <dd title={session.created_at}>
              {formatRelativeTime(session.created_at)}
            </dd>
            {session.ready_at ? (
              <>
                <dt>Ready</dt>
                <dd title={session.ready_at}>
                  {formatRelativeTime(session.ready_at)}
                </dd>
              </>
            ) : null}
            {session.provisioner === 'mock' ? (
              <>
                <dt>Note</dt>
                <dd className="muted">
                  Mock sessions have no RDP guest. For a real desktop, recreate
                  after{' '}
                  <span className="mono">SESSIONS_PROVISIONER=docker</span> (and
                  restart the stack).
                </dd>
              </>
            ) : null}
          </dl>
        </details>
      </section>

      <section className="settings-section" aria-labelledby="meta-heading">
        <h2 id="meta-heading">Metadata</h2>
        <MetaBody type="session" id={session.id} />
      </section>
    </main>
  )
}
