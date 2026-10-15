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
  limit?: number
  cursor?: string
}

export type AuditListResponse = {
  events: AuditEvent[]
  nextCursor: string | null
}

export async function fetchAudit(
  query: AuditQuery = {},
  signal?: AbortSignal,
): Promise<AuditListResponse> {
  const params = new URLSearchParams()
  if (query.actor) params.set('actor', query.actor)
  if (query.namespace) params.set('namespace', query.namespace)
  if (query.repo) params.set('repo', query.repo)
  if (query.action) params.set('action', query.action)
  if (query.since) params.set('since', query.since)
  if (query.until) params.set('until', query.until)
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit != null) params.set('limit', String(query.limit))
  const qs = params.toString()
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
