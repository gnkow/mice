import { Box, Layers, Plug as ActionPlug, Tags, RefreshCw as ActionRefreshCw, Square as ActionSquare, Trash2 as ActionTrash2 } from 'lucide-react'
import { MetaBody } from '../components/MetaPanel'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { SessionWorkspacesTab } from '../components/SessionWorkspacesTab'
import { StatusPill } from '../components/StatusPill'
import { StateBlock } from '../components/StateBlock'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe, hasEffectivePermission } from '../lib/auth'
import { confirmDelete } from '../lib/confirmDelete'
import {
  connectAndOpen,
  destroySession,
  getSession,
  retrySession,
  sessionMounts,
  sessionTitle,
  shortenSessionId,
  stopSession,
  type DesktopSession,
} from '../lib/sessions'
import { formatRelativeTime } from '../lib/time'
import { FavoriteStar } from '../components/FavoriteStar'

type Tab = 'workspaces' | 'container' | 'metadata'
const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'workspaces', label: 'Workspaces', icon: Layers },
  { id: 'container', label: 'Container', icon: Box },
  { id: 'metadata', label: 'Metadata', icon: Tags },
]

export function SessionPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = tabParam === 'metadata' || tabParam === 'container' ? tabParam : 'workspaces'
  const setTab = (t: Tab) => setParams(t === 'workspaces' ? {} : { tab: t }, { replace: true })
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  const [session, setSession] = useState<DesktopSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mayConnect =
    authz.kind === 'ok' &&
    !!authz.data &&
    (!authz.data.enforce ||
      hasEffectivePermission(authz.data, 'session:connect') ||
      hasEffectivePermission(authz.data, 'session:delete'))

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
    try {
      if (await connectAndOpen(sessionId)) await reload()
    } catch (err) {
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
  const mounts = sessionMounts(session)
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
            <FavoriteStar type="session" id={session.id} label={title} />
            <span className="job-page-id mono muted" title={session.id}>
              {shortenSessionId(session.id, 12)}
            </span>
            <span className="job-page-tags">
              <span className="pill">{session.provisioner}</span>
              <StatusPill status={session.status} />
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
      {(session.notices ?? []).map((n) => (
        <p key={n} className="flash job-page-error" role="status">
          {n}
        </p>
      ))}
      {session.error ? (
        <p className="flash flash-error job-page-error" role="status">
          {session.error}
        </p>
      ) : null}

      <section className="job-page-summary" aria-label="Session summary">
        <div className="jobs-card-refs job-page-refs">
          <span className="jobs-ref">
            <span className="jobs-ref-label">Workspaces</span>
            {mounts.length === 0 ? <span className="muted">None</span> : <span className="mono">{mounts.length}</span>}
          </span>
          <span className="jobs-ref">
            <span className="jobs-ref-label">Created</span>
            <span title={session.created_at}>{formatRelativeTime(session.created_at)}</span>
          </span>
          {session.ready_at ? (
            <span className="jobs-ref">
              <span className="jobs-ref-label">Ready</span>
              <span title={session.ready_at}>{formatRelativeTime(session.ready_at)}</span>
            </span>
          ) : null}
        </div>
      </section>

      <div className="tab-bar" role="tablist" aria-label="Session views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`session-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`session-panel-${t.id}`}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={14} aria-hidden="true" className="button-label-icon" />
            {t.label}
          </button>
        ))}
      </div>

      <section
        className="job-page-panel"
        role="tabpanel"
        id={`session-panel-${tab}`}
        aria-labelledby={`session-tab-${tab}`}
      >
        {tab === 'workspaces' ? (
          <SessionWorkspacesTab session={session} onChanged={reload} onError={setError} />
        ) : tab === 'container' ? (
          <dl className="jobs-meta job-page-meta">
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
              cpu {session.resources.cpu} · mem {session.resources.memory} · disk {session.resources.disk}
            </dd>
            {session.endpoints?.container_name ? (
              <>
                <dt>Container</dt>
                <dd className="mono">{session.endpoints.container_name}</dd>
              </>
            ) : null}
            <dt>Provisioner</dt>
            <dd>{session.provisioner}</dd>
            {session.template_id ? (
              <>
                <dt>Template</dt>
                <dd className="mono">{session.template_id}</dd>
              </>
            ) : null}
            <dt>Guest user</dt>
            <dd className="mono">{session.guest_user || '—'}</dd>
            <dt>Session id</dt>
            <dd className="mono">{session.id}</dd>
            <dt>Created</dt>
            <dd title={session.created_at}>{formatRelativeTime(session.created_at)}</dd>
            {session.ready_at ? (
              <>
                <dt>Ready</dt>
                <dd title={session.ready_at}>{formatRelativeTime(session.ready_at)}</dd>
              </>
            ) : null}
            {session.provisioner === 'mock' ? (
              <>
                <dt>Note</dt>
                <dd className="muted">
                  Mock sessions have no RDP guest. For a real desktop, recreate after{' '}
                  <span className="mono">SESSIONS_PROVISIONER=docker</span> (and restart the stack).
                </dd>
              </>
            ) : null}
          </dl>
        ) : (
          <MetaBody type="session" id={session.id} />
        )}
      </section>
    </main>
  )
}
