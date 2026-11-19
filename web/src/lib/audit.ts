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
  /** Present on Intent/Outcome chain events; unpaired Intent rows stay visible in the list. */
  phase?: 'intent' | 'outcome'
  /** On an outcome: the Intent id it completes. */
  intent_id?: string
  method: string
  path: string
  status: number
  action: string
  action_label?: string
  namespace?: string
  repo?: string
  message?: string
  /** Free-text justification when the mutation required a reason. */
  reason?: string
  reason_source?: 'explicit' | 'commit-message'
  /** Pick-list category when a reason was required. */
  category?: string
  /** Change-control record id for regulated mutations. */
  change_control_id?: string
  /** Dataset commit ids before and after a dataset mutation. */
  dataset?: AuditDataset
  detail?: Record<string, unknown>
}

/** Unpaired Intent rows in a list page (honest gap — no Outcome yet). */
export function unpairedIntentEvents(events: AuditEvent[]): AuditEvent[] {
  return events.filter((e) => e.phase === 'intent')
}

export type AuditDataset = { base?: string; head?: string }

/** The caller may not read the audit trail (HTTP 403). */
export class AuditDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditDeniedError'
  }
}

export type AuditLoadResult =
  | { kind: 'ok'; data: AuditListResponse }
  | { kind: 'denied'; reason: string }

export type AuditVerifyResult =
  | { ok: true; events: number; verifiedAt: string; tip: { txid: number; root: string } }
  | { ok: false; events: number; verifiedAt: string; firstBreak: { seq: number; reason: string } }

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
  label?: string
}
export type AuditFacets = {
  actions: AuditActionOption[]
  actors: AuditResource[]
  namespaces: AuditResource[]
  repos: AuditResource[]
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
  if (res.status === 403) {
    throw new AuditDeniedError(await errorBody(res, 'You do not have permission to view the audit log.'))
  }
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? 'Authentication required'
        : `Failed to load audit log (${res.status})`,
    )
  }
  return (await res.json()) as AuditListResponse
}

/** Like {@link fetchAudit}, but maps an authorization denial (403) to a `denied` result. */
export async function loadAudit(
  query: AuditQuery = {},
  signal?: AbortSignal,
): Promise<AuditLoadResult> {
  try {
    return { kind: 'ok', data: await fetchAudit(query, signal) }
  } catch (err) {
    if (err instanceof AuditDeniedError) return { kind: 'denied', reason: err.message }
    throw err
  }
}

/** The server's `{ error }` message when present, else the fallback. */
async function errorBody(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    return typeof body.error === 'string' && body.error ? body.error : fallback
  } catch {
    return fallback
  }
}

/** Re-walk the ledger proofs and return the chain tip or the first break. */
export async function verifyAuditChain(signal?: AbortSignal): Promise<AuditVerifyResult> {
  const res = await fetch('/auth/audit/verify', { credentials: 'same-origin', signal })
  if (res.status === 403) {
    throw new AuditDeniedError(await errorBody(res, 'You do not have permission to verify the audit log.'))
  }
  if (!res.ok) throw new Error(await errorBody(res, `Verification failed (${res.status})`))
  return (await res.json()) as AuditVerifyResult
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
  const raw = (await res.json()) as Partial<AuditFacets>
  return {
    actions: raw.actions ?? [],
    actors: raw.actors ?? [],
    namespaces: raw.namespaces ?? [],
    repos: raw.repos ?? [],
    sessions: raw.sessions ?? [],
    workspaces: raw.workspaces ?? [],
    jobs: raw.jobs ?? [],
  }
}

export type AuditExportFormat = 'csv' | 'pdf' | 'bundle'

const EXPORT_PATH: Record<AuditExportFormat, string> = {
  csv: 'export.csv',
  pdf: 'export.pdf',
  bundle: 'export.bundle',
}
const EXPORT_FALLBACK_NAME: Record<AuditExportFormat, string> = {
  csv: 'audit.csv',
  pdf: 'audit.pdf',
  bundle: 'audit-bundle.json',
}

/** Download an export for the given filters (paging params are ignored). */
export async function exportAudit(
  format: AuditExportFormat,
  query: AuditQuery = {},
): Promise<void> {
  const params = buildParams({ ...query, cursor: undefined, limit: undefined })
  const qs = params.toString()
  const res = await fetch(`/auth/audit/${EXPORT_PATH[format]}${qs ? `?${qs}` : ''}`, {
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw new Error(await errorBody(res, `Export failed (${res.status})`))
  }
  const blob = await res.blob()
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    EXPORT_FALLBACK_NAME[format]
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Download the CSV for the given filters (paging params are ignored). */
export function exportAuditCsv(query: AuditQuery = {}): Promise<void> {
  return exportAudit('csv', query)
}
