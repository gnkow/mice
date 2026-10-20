export type SessionStatus =
  | 'provisioning'
  | 'ready'
  | 'connected'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'destroyed'

export type SessionMount = {
  namespace: string
  repo: string
  workspace_id: string | null
  pin_commit: string | null
  mount_mode: 'ro' | 'rw'
  mount_path: string
}

export type SessionMountInput = {
  namespace: string
  repo: string
  workspace_id?: string | null
  pin_commit?: string | null
  mount_mode?: 'ro' | 'rw'
}

export type DesktopSession = {
  id: string
  status: SessionStatus
  owner: { sub: string; iss: string; email: string; name: string }
  template_id: string | null
  image: string
  image_digest: string | null
  provisioner: string
  endpoints: {
    rdp_host: string
    rdp_port: number
    container_name: string | null
  } | null
  guest_user: string
  mounts: SessionMount[]
  /** Legacy mirrors (first mount); prefer mounts[]. */
  workspace_ref: {
    namespace: string
    repo: string
    workspace_id: string | null
  } | null
  pin_commit: string | null
  mount_path: string | null
  mount_mode: 'ro' | 'rw' | null
  resources: { cpu: string; memory: string; disk: string }
  recording: boolean
  created_at: string
  ready_at: string | null
  error: string | null
}

export type SessionTemplate = {
  id: string
  name: string
  description: string
  image: string
  provisioner: string
  default_resources: { cpu: string; memory: string; disk: string }
}

export type ConnectResult = {
  session: DesktopSession
  connect: {
    client_url: string
    ticket: string
    expires_in: number
    backend: string
    token?: string
    ws_path?: string
  }
}

async function api<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    signal,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      /* ignore */
    }
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export function listSessions(signal?: AbortSignal) {
  return api<{ sessions: DesktopSession[] }>('/auth/sessions', undefined, signal)
}

export function listSessionTemplates(signal?: AbortSignal) {
  return api<{ templates: SessionTemplate[] }>(
    '/auth/sessions/templates',
    undefined,
    signal,
  )
}

export function getSession(id: string, signal?: AbortSignal) {
  return api<{ session: DesktopSession }>(
    `/auth/sessions/${encodeURIComponent(id)}`,
    undefined,
    signal,
  )
}

export function createSession(
  body: {
    template_id?: string
    image?: string
    mounts?: SessionMountInput[]
    workspace_ref?: {
      namespace: string
      repo: string
      workspace_id?: string | null
    } | null
    pin_commit?: string | null
    mount_mode?: 'ro' | 'rw'
    recording?: boolean
  },
  signal?: AbortSignal,
) {
  return api<{ session: DesktopSession }>(
    '/auth/sessions',
    { method: 'POST', body: JSON.stringify(body) },
    signal,
  )
}

export function connectSession(id: string, signal?: AbortSignal) {
  return api<ConnectResult>(
    `/auth/sessions/${encodeURIComponent(id)}/connect`,
    { method: 'POST', body: '{}' },
    signal,
  )
}

export function stopSession(id: string, signal?: AbortSignal) {
  return api<{ session: DesktopSession }>(
    `/auth/sessions/${encodeURIComponent(id)}/stop`,
    { method: 'POST', body: '{}' },
    signal,
  )
}

export function destroySession(id: string, signal?: AbortSignal) {
  return api<{ session: DesktopSession }>(
    `/auth/sessions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    signal,
  )
}

export function retrySession(id: string, signal?: AbortSignal) {
  return api<{ session: DesktopSession }>(
    `/auth/sessions/${encodeURIComponent(id)}/retry`,
    { method: 'POST', body: '{}' },
    signal,
  )
}

export function syncSessionMount(
  sessionId: string,
  mountKey: string,
  files?: string[],
  signal?: AbortSignal,
) {
  return api<{
    success: boolean
    added: string[]
    modified: string[]
    removed: string[]
    uploaded: number
    errors: string[]
  }>(
    `/auth/sessions/${encodeURIComponent(sessionId)}/sync/${encodeURIComponent(mountKey)}`,
    { method: 'POST', body: JSON.stringify({ files }) },
    signal,
  )
}

export function getMountDiff(
  sessionId: string,
  mountKey: string,
  signal?: AbortSignal,
) {
  return api<{
    workspace_id: string
    namespace: string
    repo: string
    added: string[]
    modified: string[]
    removed: string[]
  }>(
    `/auth/sessions/${encodeURIComponent(sessionId)}/mounts/${encodeURIComponent(mountKey)}/diff`,
    undefined,
    signal,
  )
}

export function fetchConnectToken(
  id: string,
  ticket: string,
  signal?: AbortSignal,
) {
  return api<{ token: string; ws_path: string; backend: string }>(
    `/auth/sessions/${encodeURIComponent(id)}/connect-token?ticket=${encodeURIComponent(ticket)}`,
    undefined,
    signal,
  )
}

export function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'provisioning':
      return 'Provisioning'
    case 'ready':
      return 'Ready'
    case 'connected':
      return 'Connected'
    case 'stopping':
      return 'Stopping'
    case 'stopped':
      return 'Stopped'
    case 'failed':
      return 'Failed'
    case 'destroyed':
      return 'Destroyed'
    default:
      return status
  }
}

/** Pill class for session status (matches Jobs status colors). */
export function sessionStatusClass(status: SessionStatus): string {
  if (status === 'ready' || status === 'connected') return 'pill ok'
  if (status === 'failed' || status === 'destroyed') return 'pill bad'
  if (
    status === 'provisioning' ||
    status === 'stopping' ||
    status === 'stopped'
  ) {
    return 'pill warn'
  }
  return 'pill'
}

export function sessionTitle(session: DesktopSession): string {
  const tpl = (session.template_id || '').trim()
  if (tpl) {
    return tpl
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
  const image = sessionImageLabel(session)
  return image || `Session ${session.id.slice(0, 8)}`
}

/** Short image ref for cards (strip registry path). */
export function sessionImageLabel(session: DesktopSession): string {
  const raw = (session.image || '').trim()
  if (!raw) return ''
  const noTag = raw.split('@')[0] || raw
  const parts = noTag.split('/')
  return parts[parts.length - 1] || noTag
}

export function shortenSessionId(id: string, n = 12): string {
  if (id.length <= n) return id
  return `${id.slice(0, n)}…`
}

export function sessionMounts(session: DesktopSession): SessionMount[] {
  if (Array.isArray(session.mounts) && session.mounts.length > 0) {
    return session.mounts
  }
  const ref = session.workspace_ref
  if (!ref) return []
  return [
    {
      namespace: ref.namespace,
      repo: ref.repo,
      workspace_id: ref.workspace_id,
      pin_commit: session.pin_commit,
      mount_mode: session.mount_mode === 'ro' ? 'ro' : 'rw',
      mount_path: session.mount_path || '/data',
    },
  ]
}

export function formatSessionMount(m: SessionMount): string {
  const base = `${m.namespace}/${m.repo}`
  if (m.workspace_id) return `${base} · ${m.workspace_id}`
  if (m.pin_commit) return `${base} @ ${m.pin_commit.slice(0, 12)}`
  return base
}

export function sessionWorkspaceLabel(session: DesktopSession): string | null {
  const mounts = sessionMounts(session)
  if (mounts.length === 0) return null
  if (mounts.length === 1) return formatSessionMount(mounts[0]!)
  return `${mounts.length} mounts`
}

/** True when the session bind-mounts a workspace (not only a commit pin) for this repo. */
export function sessionMountsRepoWorkspace(
  session: DesktopSession,
  namespace: string,
  repo: string,
): boolean {
  const ns = namespace.trim().toLowerCase()
  const r = repo.trim().toLowerCase()
  return sessionMounts(session).some(
    (m) =>
      m.namespace.trim().toLowerCase() === ns &&
      m.repo.trim().toLowerCase() === r &&
      !!m.workspace_id?.trim(),
  )
}

export function sessionsMountingRepoWorkspace(
  sessions: DesktopSession[],
  namespace: string,
  repo: string,
): DesktopSession[] {
  return sessions.filter((s) => sessionMountsRepoWorkspace(s, namespace, repo))
}
