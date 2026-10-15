export type LineageKind =
  | 'upload'
  | 'create'
  | 'edit'
  | 'move'
  | 'rename'
  | 'copy'
  | 'delete'
  | 'restore'

export type FileVersion = {
  namespace: string
  repo: string
  path: string
  contentHash?: string
  commitId?: string
}

export type LineageOp = {
  id: string
  ts: string
  kind: LineageKind
  namespace: string
  repo: string
  branch?: string
  inputs: FileVersion[]
  outputs: FileVersion[]
  actor?: {
    sub: string
    iss: string
    email: string
    name: string
  }
  via?: 'session' | 'pat'
  commitId?: string
  auditEventId?: string
  source: 'explicit' | 'derived'
  confidence: 'high' | 'low'
  detail?: Record<string, unknown>
}

export type LineageQuery = {
  namespace: string
  repo: string
  path?: string
  contentHash?: string
  direction?: 'ancestors' | 'descendants' | 'both'
  depth?: number
  kind?: LineageKind
  limit?: number
  cursor?: string
}

export type LineageListResponse = {
  operations: LineageOp[]
  nextCursor: string | null
}

export async function fetchLineage(
  query: LineageQuery,
  signal?: AbortSignal,
): Promise<LineageListResponse> {
  const params = new URLSearchParams()
  params.set('namespace', query.namespace)
  params.set('repo', query.repo)
  if (query.path) params.set('path', query.path)
  if (query.contentHash) params.set('contentHash', query.contentHash)
  if (query.direction) params.set('direction', query.direction)
  if (query.depth != null) params.set('depth', String(query.depth))
  if (query.kind) params.set('kind', query.kind)
  if (query.cursor) params.set('cursor', query.cursor)
  if (query.limit != null) params.set('limit', String(query.limit))
  const res = await fetch(`/auth/lineage?${params}`, {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? 'Authentication required'
        : res.status === 403
          ? 'Not allowed to view lineage'
          : `Failed to load lineage (${res.status})`,
    )
  }
  return (await res.json()) as LineageListResponse
}

export async function rebuildLineage(
  body: { namespace: string; repo: string; branch?: string; path: string },
  signal?: AbortSignal,
): Promise<{ created: number; operations: LineageOp[] }> {
  const res = await fetch('/auth/lineage/rebuild', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error || `Rebuild failed (${res.status})`)
  }
  return (await res.json()) as { created: number; operations: LineageOp[] }
}
