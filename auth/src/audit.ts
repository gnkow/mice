import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { env } from './env.js'
import { createJsonlLog } from './stores.js'
import { auditActionLabel } from './auditLabels.js'
import { kindOf } from './principal.js'
import { getServicePrincipal } from './servicePrincipals.js'
import type { SessionUser } from './session.js'

export type AuditVia = 'session' | 'pat'

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
  via: AuditVia
  method: string
  path: string
  status: number
  action: string
  namespace?: string
  repo?: string
  message?: string
  detail?: Record<string, unknown>
  /** Set when the actor is a service principal; `owner` is its accountable human. */
  actorKind?: 'service'
  owner?: AuditActor
}

export type AuditQuery = {
  actor?: string
  namespace?: string
  repo?: string
  action?: string
  since?: string
  until?: string
  limit?: number
  /** Exclusive: return events older than this id (reverse chronological). */
  cursor?: string
  sessionId?: string
  workspaceId?: string
  jobId?: string
  via?: AuditVia
  /** AuthZ scope: only events in these namespaces (applied before paging). */
  allowedNamespaces?: string[]
}

export type AuditResource = {
  id: string
  count: number
  lastTs: string
  namespace?: string
  repo?: string
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
let auditObserver: ((event: AuditEvent) => void) | undefined

export function setAuditObserver(observer: (event: AuditEvent) => void): void {
  auditObserver = observer
}

function storePath(): string {
  return join(env.dataDir, 'audit.jsonl')
}

const log = createJsonlLog<AuditEvent>(storePath)

export function actorFromUser(user: SessionUser): AuditActor {
  return {
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
  }
}


export function extractMessageFromJson(
  body: Record<string, unknown>,
): string | undefined {
  for (const key of ['message', 'commit_message']) {
    const v = body[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
  }
  return undefined
}

export function extractMessageFromForm(form: FormData): string | undefined {
  for (const key of ['message', 'commit_message']) {
    const v = form.get(key)
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
  }
  return undefined
}

export function extractRepoCreateFromJson(
  body: Record<string, unknown>,
): { namespace?: string; repo?: string } {
  const namespace =
    typeof body.namespace === 'string' ? body.namespace : undefined
  const repo = typeof body.name === 'string' ? body.name : undefined
  return { namespace, repo }
}

function serviceActorFields(actor: AuditActor): Pick<AuditEvent, 'actorKind' | 'owner'> {
  if (kindOf(actor) !== 'service') return {}
  const o = getServicePrincipal(actor.sub)?.owner
  return { actorKind: 'service', ...(o ? { owner: { sub: o.sub, iss: o.iss, email: o.email, name: o.name } } : {}) }
}

export function appendAudit(
  partial: Omit<AuditEvent, 'id' | 'ts'> & { id?: string; ts?: string },
): AuditEvent | null {
  const event: AuditEvent = {
    id: partial.id ?? randomBytes(8).toString('hex'),
    ts: partial.ts ?? new Date().toISOString(),
    actor: partial.actor,
    via: partial.via,
    method: partial.method,
    path: partial.path,
    status: partial.status,
    action: partial.action,
    ...serviceActorFields(partial.actor),
    ...(partial.namespace ? { namespace: partial.namespace } : {}),
    ...(partial.repo ? { repo: partial.repo } : {}),
    ...(partial.message ? { message: partial.message } : {}),
    ...(partial.detail && Object.keys(partial.detail).length
      ? { detail: partial.detail }
      : {}),
  }
  try {
    log.append(event)
    if (auditObserver) {
      try {
        auditObserver(event)
      } catch (error) {
        // The journal remains durable; the notification worker retries projection.
        console.error('[mice-auth] notification capture failed; replay required', error)
      }
    }
    return event
  } catch (err) {
    console.error('[mice-auth] audit append failed', err)
    return null
  }
}

function readAllEvents(): AuditEvent[] {
  return log.readAll()
}

function detailStrings(
  detail: Record<string, unknown> | undefined,
  single: string,
  plural?: string,
): string[] {
  if (!detail) return []
  const out: string[] = []
  const one = detail[single]
  if (typeof one === 'string' && one) out.push(one)
  if (plural) {
    const many = detail[plural]
    if (Array.isArray(many)) {
      for (const v of many) if (typeof v === 'string' && v) out.push(v)
    }
  }
  return out
}

/** Session ids an event refers to. */
export function eventSessionIds(e: AuditEvent): string[] {
  return detailStrings(e.detail, 'session_id')
}

/** Job ids an event refers to (single or batch). */
export function eventJobIds(e: AuditEvent): string[] {
  return detailStrings(e.detail, 'job_id', 'job_ids')
}

/** Workspace ids an event refers to, including session mounts. */
export function eventWorkspaceIds(e: AuditEvent): string[] {
  const ids = detailStrings(e.detail, 'workspace_id')
  const mounts = e.detail?.mounts
  if (Array.isArray(mounts)) {
    for (const m of mounts) {
      const w = (m as { workspace_id?: unknown } | null)?.workspace_id
      if (typeof w === 'string' && w) ids.push(w)
    }
  }
  return ids
}

function filterEvents(q: AuditQuery): AuditEvent[] {
  let events = readAllEvents()

  // Newest first
  events.reverse()

  if (q.allowedNamespaces) {
    const allowed = new Set(q.allowedNamespaces)
    events = events.filter((e) => e.namespace && allowed.has(e.namespace))
  }
  if (q.actor) {
    const a = q.actor.toLowerCase()
    events = events.filter(
      (e) =>
        e.actor.sub.toLowerCase().includes(a) ||
        e.actor.email.toLowerCase().includes(a) ||
        e.actor.name.toLowerCase().includes(a),
    )
  }
  if (q.namespace) {
    events = events.filter((e) => e.namespace === q.namespace)
  }
  if (q.repo) {
    events = events.filter((e) => e.repo === q.repo)
  }
  if (q.action) {
    events = events.filter(
      (e) => e.action === q.action || e.action.startsWith(`${q.action}.`),
    )
  }
  if (q.via) {
    events = events.filter((e) => e.via === q.via)
  }
  if (q.sessionId) {
    const id = q.sessionId
    events = events.filter((e) => eventSessionIds(e).includes(id))
  }
  if (q.workspaceId) {
    const id = q.workspaceId
    events = events.filter((e) => eventWorkspaceIds(e).includes(id))
  }
  if (q.jobId) {
    const id = q.jobId
    events = events.filter((e) => eventJobIds(e).includes(id))
  }
  if (q.since) {
    const since = q.since
    events = events.filter((e) => e.ts >= since)
  }
  if (q.until) {
    const until = q.until
    events = events.filter((e) => e.ts <= until)
  }
  return events
}

export function queryAudit(q: AuditQuery): {
  events: AuditEvent[]
  nextCursor: string | null
} {
  const limit = Math.min(
    Math.max(1, q.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  )
  let events = filterEvents(q)

  if (q.cursor) {
    const idx = events.findIndex((e) => e.id === q.cursor)
    if (idx >= 0) events = events.slice(idx + 1)
  }

  const page = events.slice(0, limit)
  const nextCursor =
    page.length === limit && events.length > limit
      ? (page[page.length - 1]?.id ?? null)
      : null

  return { events: page, nextCursor }
}

export const EXPORT_MAX_ROWS = 50_000

/** All matching events (newest first) for export; ignores paging, capped at EXPORT_MAX_ROWS. */
export function queryAuditForExport(q: AuditQuery): {
  events: AuditEvent[]
  truncated: boolean
} {
  const events = filterEvents({ ...q, cursor: undefined, limit: undefined })
  return {
    events: events.slice(0, EXPORT_MAX_ROWS),
    truncated: events.length > EXPORT_MAX_ROWS,
  }
}

const FACET_CAP = 200

function collectResources(
  events: AuditEvent[],
  pick: (e: AuditEvent) => string[],
): AuditResource[] {
  const map = new Map<string, AuditResource>()
  // events are newest first, so the first sighting carries the latest timestamp
  for (const e of events) {
    for (const id of pick(e)) {
      const cur = map.get(id)
      if (cur) {
        cur.count += 1
        if (!cur.namespace && e.namespace) cur.namespace = e.namespace
        if (!cur.repo && e.repo) cur.repo = e.repo
      } else {
        map.set(id, {
          id,
          count: 1,
          lastTs: e.ts,
          ...(e.namespace ? { namespace: e.namespace } : {}),
          ...(e.repo ? { repo: e.repo } : {}),
        })
      }
    }
  }
  return [...map.values()].slice(0, FACET_CAP)
}

/** Distinct sessions / workspaces / jobs / actions seen in the (scoped) log. */
export function auditFacets(scope: Pick<AuditQuery, 'allowedNamespaces' | 'namespace'>): {
  sessions: AuditResource[]
  workspaces: AuditResource[]
  jobs: AuditResource[]
  observedActions: string[]
} {
  const events = filterEvents(scope)
  return {
    sessions: collectResources(events, eventSessionIds),
    workspaces: collectResources(events, eventWorkspaceIds),
    jobs: collectResources(events, eventJobIds),
    observedActions: [...new Set(events.map((e) => e.action))].sort(),
  }
}

export const AUDIT_CSV_COLUMNS = [
  'timestamp',
  'actor_name',
  'actor_email',
  'actor_sub',
  'actor_issuer',
  'via',
  'action',
  'action_label',
  'namespace',
  'repo',
  'session_id',
  'workspace_id',
  'job_id',
  'method',
  'path',
  'status',
  'message',
  'detail',
] as const

/** RFC 4180 quoting, plus a leading apostrophe on cells a spreadsheet would treat as a formula. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function auditEventsToCsv(events: AuditEvent[]): string {
  const lines = [AUDIT_CSV_COLUMNS.join(',')]
  for (const e of events) {
    lines.push(
      [
        e.ts,
        e.actor.name,
        e.actor.email,
        e.actor.sub,
        e.actor.iss,
        e.via,
        e.action,
        auditActionLabel(e.action),
        e.namespace,
        e.repo,
        eventSessionIds(e).join(';'),
        eventWorkspaceIds(e).join(';'),
        eventJobIds(e).join(';'),
        e.method,
        e.path,
        e.status,
        e.message,
        e.detail ? JSON.stringify(e.detail) : '',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}
