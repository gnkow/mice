import { auditActionMatches } from './auditSchema.js'

/** Minimal event shape the filter pipeline needs (avoids importing audit.ts). */
export type AuditFilterEvent = {
  id: string
  ts: string
  action: string
  via: string
  actor: { sub: string; email: string; name: string }
  namespace?: string
  repo?: string
  phase?: string
  intent_id?: string
  detail?: Record<string, unknown>
}

export type AuditFilterQuery = {
  actor?: string
  namespace?: string
  repo?: string
  action?: string
  since?: string
  until?: string
  sessionId?: string
  workspaceId?: string
  jobId?: string
  via?: string
  allowedNamespaces?: string[]
  includeChain?: boolean
}

/** Session ids an event refers to. */
export function eventSessionIds(e: AuditFilterEvent): string[] {
  return detailStrings(e.detail, 'session_id')
}

/** Job ids an event refers to (single or batch). */
export function eventJobIds(e: AuditFilterEvent): string[] {
  return detailStrings(e.detail, 'job_id', 'job_ids')
}

/** Workspace ids an event refers to, including session mounts. */
export function eventWorkspaceIds(e: AuditFilterEvent): string[] {
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

/**
 * Pure filter pipeline over an in-memory event list (newest-first).
 * Shared by the immudb scan path and the derived Postgres index so AuthZ/filter
 * behaviour stays one place (deepen US1 / query-read seam).
 */
export function applyAuditQueryFilters<T extends AuditFilterEvent>(
  eventsNewestFirst: T[],
  q: AuditFilterQuery,
): T[] {
  let events = eventsNewestFirst

  if (!q.includeChain) {
    const resolved = new Set(
      events.flatMap((e) => (e.phase === 'outcome' && e.intent_id ? [e.intent_id] : [])),
    )
    events = events.filter((e) => !(e.phase === 'intent' && resolved.has(e.id)))
  }

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
    const filter = q.action
    events = events.filter((e) => auditActionMatches(e.action, filter))
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
