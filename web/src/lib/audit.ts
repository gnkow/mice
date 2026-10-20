export type AuditActor = {
  sub: string
  iss: string
  email: string
  name: string
}

export type AuditEvent = {
  id: string
  ts: string
  actor: AuditActor
  via: 'session' | 'pat'
  method: string
  path: string
  status: number
  action: string
  action_label?: string
  namespace?: string
  repo?: string
  message?: string
  detail?: Record<string, unknown>
}

export type AuditQuery = {
  actor?: string
  namespace?: string
  repo?: string
  action?: string
  since?: string
  until?: string
  sessionId?: string
  workspaceId?: string
  jobId?: string
  limit?: number
  cursor?: string
}

export type AuditListResponse = {
  events: AuditEvent[]
  nextCursor: string | null
}

export type AuditActionOption = { value: string; label: string; group: string }
export type AuditResource = {
  id: string
  count: number
  lastTs: string
  namespace?: string
  repo?: string
}
export type AuditFacets = {
  actions: AuditActionOption[]
  sessions: AuditResource[]
  workspaces: AuditResource[]
  jobs: AuditResource[]
}

function buildParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.actor) params.set('actor', query.actor)
  if (query.namespace) params.set('namespace', query.namespace)
  if (query.repo) params.set('repo', query.repo)
  if (query.action) params.set('action', query.action)
  if (query.since) params.set('since', query.since)
  if (query.until) params.set('until', query.until)
  if (query.sessionId) params.set('session_id', query.sessionId)
  if (query.workspaceId) params.set('workspace_id', query.workspaceId)
  if (query.jobId) params.set('job_id', query.jobId)
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit != null) params.set('limit', String(query.limit))
  return params
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

/** Resource ids an event touched (for the Resource column). */
export function eventResources(ev: AuditEvent): {
  sessionId?: string
  workspaceId?: string
  jobIds: string[]
} {
  const d = ev.detail ?? {}
  const jobIds = [str(d.job_id), ...(Array.isArray(d.job_ids) ? d.job_ids.map(str) : [])].filter(
    (x): x is string => !!x,
  )
  return { sessionId: str(d.session_id), workspaceId: str(d.workspace_id), jobIds }
}

/** Fallback label if the server did not provide one. */
export function actionLabel(ev: Pick<AuditEvent, 'action' | 'action_label'>): string {
  return ev.action_label || ev.action
}

export async function fetchAudit(
  query: AuditQuery = {},
  signal?: AbortSignal,
): Promise<AuditListResponse> {
  const qs = buildParams(query).toString()
  const res = await fetch(`/auth/audit${qs ? `?${qs}` : ''}`, {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? 'Authentication required'
        : `Failed to load audit log (${res.status})`,
    )
  }
  return (await res.json()) as AuditListResponse
}

export async function fetchAuditFacets(
  query: Pick<AuditQuery, 'namespace'> = {},
  signal?: AbortSignal,
): Promise<AuditFacets> {
  const qs = buildParams(query).toString()
  const res = await fetch(`/auth/audit/facets${qs ? `?${qs}` : ''}`, {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new Error(`Failed to load audit filters (${res.status})`)
  return (await res.json()) as AuditFacets
}

/** Download the CSV for the given filters (paging params are ignored). */
export async function exportAuditCsv(query: AuditQuery = {}): Promise<void> {
  const params = buildParams({ ...query, cursor: undefined, limit: undefined })
  const qs = params.toString()
  const res = await fetch(`/auth/audit/export.csv${qs ? `?${qs}` : ''}`, {
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(`Export failed (${res.status})`)
  const blob = await res.blob()
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    'audit.csv'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
