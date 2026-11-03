import { Layers as ActionLayers, Plug as ActionPlug, Square as ActionSquare, Trash2 as ActionTrash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { fetchAuthzMe, hasEffectivePermission } from '../lib/auth'
import { confirmDelete } from '../lib/confirmDelete'
import {
  connectAndOpen,
  destroySession,
  sessionMounts,
  stopSession,
  type DesktopSession,
} from '../lib/sessions'

type Props = {
  session: DesktopSession
  mayConnect: boolean
  onChanged: () => void
  onError?: (message: string) => void
}

const MAX_WORKSPACE_LINKS = 3

export function useMaySessionConnect(): boolean {
  const authz = useAsync((signal) => fetchAuthzMe(signal), [])
  return (
    authz.kind === 'ok' &&
    !!authz.data &&
    (!authz.data.enforce ||
      hasEffectivePermission(authz.data, 'session:connect') ||
      hasEffectivePermission(authz.data, 'session:delete'))
  )
}

/** Icon-only quick actions for a session row: connect, stop, destroy and mounted workspaces. */
export function SessionRowActions({ session, mayConnect, onChanged, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const canConnect = mayConnect && (session.status === 'ready' || session.status === 'connected')
  const canStop = ['ready', 'connected', 'provisioning'].includes(session.status)
  const canDestroy = session.status !== 'destroyed'

  const workspaces: { id: string; namespace: string; repo: string }[] = []
  for (const m of sessionMounts(session)) {
    if (m.workspace_id && !workspaces.some((w) => w.id === m.workspace_id)) {
      workspaces.push({ id: m.workspace_id, namespace: m.namespace, repo: m.repo })
    }
  }

  async function run(fn: () => Promise<unknown>, fallback: string) {
    setBusy(true)
    try {
      await fn()
      onChanged()
    } catch (err) {
      onError?.(err instanceof Error ? err.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  async function onDestroy() {
    const ok = await confirmDelete({
      title: 'Destroy this session?',
      detail: 'The desktop container will be removed. This cannot be undone from the UI.',
      requireTypedConfirm: false,
    })
    if (ok) await run(() => destroySession(session.id), 'Destroy failed')
  }

  return (
    <div className="session-row-actions">
      {workspaces.slice(0, MAX_WORKSPACE_LINKS).map((w) => (
        <Link
          key={w.id}
          className="icon-round"
          title={`Workspace ${w.id} (${w.namespace}/${w.repo})`}
          aria-label={`Open workspace ${w.id}`}
          to={`/n/${encodeURIComponent(w.namespace)}/r/${encodeURIComponent(w.repo)}/workspaces/${encodeURIComponent(w.id)}`}
        >
          <ActionLayers size={14} aria-hidden />
        </Link>
      ))}
      {workspaces.length > MAX_WORKSPACE_LINKS ? (
        <span className="muted small" title={workspaces.slice(MAX_WORKSPACE_LINKS).map((w) => w.id).join(', ')}>
          +{workspaces.length - MAX_WORKSPACE_LINKS}
        </span>
      ) : null}
      <button
        type="button"
        className="icon-round"
        disabled={busy || !canConnect}
        title={mayConnect ? 'Connect' : 'Requires session_connect instance permission'}
        aria-label={`Connect to session ${session.id}`}
        onClick={() => void run(() => connectAndOpen(session.id), 'Connect failed')}
      >
        <ActionPlug size={14} aria-hidden />
      </button>
      <button
        type="button"
        className="icon-round"
        disabled={busy || !canStop}
        title="Stop"
        aria-label={`Stop session ${session.id}`}
        onClick={() => void run(() => stopSession(session.id), 'Stop failed')}
      >
        <ActionSquare size={14} aria-hidden />
      </button>
      <button
        type="button"
        className="icon-round workspace-delete"
        disabled={busy || !canDestroy}
        title="Destroy"
        aria-label={`Destroy session ${session.id}`}
        onClick={() => void onDestroy()}
      >
        <ActionTrash2 size={14} aria-hidden />
      </button>
    </div>
  )
}
