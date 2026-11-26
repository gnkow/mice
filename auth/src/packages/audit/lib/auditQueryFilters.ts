import { auditActionMatches } from './auditSchema.js'

/** Investigation Focus presets (`?focus=` from Audit UI). */
export const AUDIT_FOCUS_VALUES = ['signatures', 'files', 'merges', 'roles'] as const
export type AuditFocus = (typeof AUDIT_FOCUS_VALUES)[number]

export function parseAuditFocus(raw: string | undefined | null): AuditFocus | undefined {
  if (!raw) return undefined
  return (AUDIT_FOCUS_VALUES as readonly string[]).includes(raw)
    ? (raw as AuditFocus)
    : undefined
}

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
  /** Ceremony / signed mutation rows carry this even when action is not esign.*. */
  signature_id?: string
  detail?: Record<string, unknown>
}

export type AuditFilterQuery = {
  actor?: string
  namespace?: string
  repo?: string
  action?: string
  /**
   * Investigation Focus (#155): signatures = signed rows / esign.*;
   * merges = merge + merge_request.*; files/roles = action prefix.
   * Takes precedence over `action` when set.
   */
  focus?: AuditFocus
  since?: string
  until?: string
  sessionId?: string
  workspaceId?: string
  jobId?: string
  via?: string
  allowedNamespaces?: string[]
  includeChain?: boolean
  /** Exact action names to omit (Auditor visibility). */
  excludeActions?: string[]
}

/** True when the row is a signature ceremony or a mutation that consumed one. */
export function eventIsSigned(e: AuditFilterEvent): boolean {
  if (e.signature_id) return true
  if (e.action.startsWith('esign.') || e.action === 'signature.created') return true
  return false
}

function eventMatchesFocus(e: AuditFilterEvent, focus: AuditFocus): boolean {
  switch (focus) {
    case 'signatures':
      return eventIsSigned(e)
    case 'files':
      return auditActionMatches(e.action, 'file')
    case 'merges':
      return (
        auditActionMatches(e.action, 'merge') || auditActionMatches(e.action, 'merge_request')
      )
    case 'roles':
      return auditActionMatches(e.action, 'role')
  }
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
  if (q.focus) {
    const focus = q.focus
    events = events.filter((e) => eventMatchesFocus(e, focus))
  } else if (q.action) {
    const filters = q.action
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    events = events.filter((e) => filters.some((f) => auditActionMatches(e.action, f)))
  }
  if (q.excludeActions && q.excludeActions.length > 0) {
    const hidden = new Set(q.excludeActions)
    events = events.filter((e) => !hidden.has(e.action))
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
