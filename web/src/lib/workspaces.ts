export type MiceWorkspaceStatus = 'preparing' | 'ready' | 'error'

export type WorkspaceLease = {
  id: string
  workspace_id: string
  mode: 'read' | 'write'
  holder: { kind: 'job' | 'session' | 'user' | 'api'; id: string; label?: string; user?: string }
  created_at: string
  expires_at: string
  renewed_at?: string
}

export type MiceWorkspace = {
  id: string
  kind: 'user' | 'auto'
  name: string
  namespace: string
  repo: string
  branch: string | null
  base_commit: string
  lower_commit: string
  status: MiceWorkspaceStatus
  op: string
  last_error: string | null
  progress: {
    phase: string
    files_done: number
    files_total: number
    bytes_done: number
    bytes_total: number
  } | null
  upper_bytes: number
  change_counts: { added: number; modified: number; removed: number }
  quota_bytes: number
  driver: 'overlay' | 'reflink' | 'copy'
  behind: boolean
  leases?: WorkspaceLease[]
  writer?: WorkspaceLease['holder'] | null
  session_count?: number
  mountable_modes?: ('ro' | 'rw')[]
  created_by: string
  created_at: string
  updated_at: string
}

export type WorkspaceChanges = {
  added: { path: string; size: number }[]
  modified: { path: string; size: number }[]
  removed: { path: string }[]
}

async function api<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    signal,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
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

export function listMiceWorkspaces(
  filter?: { namespace?: string; repo?: string },
  signal?: AbortSignal,
) {
  const q = new URLSearchParams()
  if (filter?.namespace) q.set('namespace', filter.namespace)
  if (filter?.repo) q.set('repo', filter.repo)
  const qs = q.toString()
  return api<{ workspaces: MiceWorkspace[] }>(`/auth/workspaces${qs ? `?${qs}` : ''}`, undefined, signal)
}

export function createMiceWorkspace(body: {
  namespace: string
  repo: string
  name?: string
  source: { branch: string } | { commit: string }
}) {
  return api<{ workspace: MiceWorkspace }>('/auth/workspaces', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getMiceWorkspace(id: string, signal?: AbortSignal) {
  return api<{ workspace: MiceWorkspace }>(`/auth/workspaces/${encodeURIComponent(id)}`, undefined, signal)
}

export function deleteMiceWorkspace(id: string) {
  return api<{ ok: boolean }>(`/auth/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function retryMiceWorkspace(id: string) {
  return api<{ workspace: MiceWorkspace }>(`/auth/workspaces/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
  })
}

export function getMiceWorkspaceChanges(id: string, signal?: AbortSignal) {
  return api<WorkspaceChanges>(`/auth/workspaces/${encodeURIComponent(id)}/changes`, undefined, signal)
}

export function listWorkspaceLeases(id: string, signal?: AbortSignal) {
  return api<{ leases: WorkspaceLease[] }>(`/auth/workspaces/${encodeURIComponent(id)}/leases`, undefined, signal)
}

export function releaseWorkspaceLease(id: string, leaseId: string) {
  return api<{ ok: boolean }>(
    `/auth/workspaces/${encodeURIComponent(id)}/leases/${encodeURIComponent(leaseId)}`,
    { method: 'DELETE' },
  )
}
