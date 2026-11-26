import { auditActionLabel } from './auditLabels.js'
import {
  applyAuditQueryFilters,
  eventJobIds,
  eventSessionIds,
  eventWorkspaceIds,
} from './auditQueryFilters.js'
import { upcastAuditEvent } from './auditSchema.js'
import { currentClock } from '../../shared/index.js'
import { ledgerOrOpen } from './auditLedgerHandle.js'
import type { AuditEvent, AuditQuery, AuditResource } from './auditTypes.js'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
const FACET_CAP = 200

export const EXPORT_MAX_ROWS = 50_000

/** Events written after ledger position `seq`; `scannedTo` is the position to resume from. */
export async function readAuditAfter(
  seq: number,
  limit?: number,
): Promise<{ events: AuditEvent[]; scannedTo: number }> {
  const { records, scannedTo } = await (await ledgerOrOpen()).readAfter(seq, limit)
  const events: AuditEvent[] = []
  for (const record of records) {
    try {
      events.push(upcastAuditEvent(JSON.parse(record.value)))
    } catch {
      /* surfaced by verifyAudit */
    }
  }
  return { events, scannedTo }
}

/** Like {@link readAuditAfter} but keeps ledger sequence numbers for index projection. */
export async function readAuditAfterWithSeq(
  seq: number,
  limit?: number,
): Promise<{ rows: Array<{ event: AuditEvent; seq: number }>; scannedTo: number }> {
  const { records, scannedTo } = await (await ledgerOrOpen()).readAfter(seq, limit)
  const rows: Array<{ event: AuditEvent; seq: number }> = []
  for (const record of records) {
    try {
      rows.push({ event: upcastAuditEvent(JSON.parse(record.value)), seq: record.seq })
    } catch {
      /* surfaced by verifyAudit */
    }
  }
  return { rows, scannedTo }
}

async function readAllEvents(): Promise<AuditEvent[]> {
  const out: AuditEvent[] = []
  for (const record of await (await ledgerOrOpen()).readAll()) {
    try {
      out.push(upcastAuditEvent(JSON.parse(record.value)))
    } catch {
      /* surfaced by verifyAudit */
    }
  }
  return out
}

/** Full trail for orphan scans and projections; not a filtered query API. */
export function listAllAuditEvents(): Promise<AuditEvent[]> {
  return readAllEvents()
}

async function filterEventsFromLedger(q: AuditQuery): Promise<AuditEvent[]> {
  const events = await readAllEvents()
  // Newest first, then shared filter pipeline (same as Postgres index path).
  return applyAuditQueryFilters([...events].reverse(), q)
}

/** Prefer the derived Postgres index when healthy; evidence path still uses immudb only. */
async function filterEvents(q: AuditQuery): Promise<AuditEvent[]> {
  try {
    const { queryAuditQueryIndex } = await import('./auditQueryIndex.js')
    const fromIndex = await queryAuditQueryIndex(q)
    if (fromIndex !== null) return fromIndex
  } catch (err) {
    console.error('[mice-auth] audit query index read failed; falling back to ledger', err)
  }
  return filterEventsFromLedger(q)
}

export async function queryAudit(q: AuditQuery): Promise<{
  events: AuditEvent[]
  nextCursor: string | null
}> {
  const limit = Math.min(Math.max(1, q.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  let events = await filterEvents(q)
  if (q.orphansOnly) {
    events = events.filter((e) => e.phase === 'intent')
  }
  // Surface unpaired Intents (aged first) at the top of each result set for auditors.
  const { prioritizeOrphanIntents } = await import('./auditOrphanAlert.js')
  events = prioritizeOrphanIntents(events, currentClock.now())

  if (q.cursor) {
    const idx = events.findIndex((e) => e.id === q.cursor)
    if (idx >= 0) events = events.slice(idx + 1)
  }

  const page = events.slice(0, limit)
  const nextCursor =
    page.length === limit && events.length > limit ? (page[page.length - 1]?.id ?? null) : null

  return { events: page, nextCursor }
}

/** All matching events (newest first) for export; ignores paging, capped at EXPORT_MAX_ROWS. */
export async function queryAuditForExport(q: AuditQuery): Promise<{
  events: AuditEvent[]
  truncated: boolean
}> {
  const events = await filterEvents({ ...q, cursor: undefined, limit: undefined })
  return {
    events: events.slice(0, EXPORT_MAX_ROWS),
    truncated: events.length > EXPORT_MAX_ROWS,
  }
}

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

function collectDistinct(
  events: AuditEvent[],
  pick: (e: AuditEvent) => string | undefined,
): AuditResource[] {
  return collectResources(events, (e) => {
    const v = pick(e)
    return v ? [v] : []
  })
}

/** Distinct actors / namespaces / repos / sessions / workspaces / jobs seen in the (scoped) log. */
export async function auditFacets(
  scope: Pick<AuditQuery, 'allowedNamespaces' | 'namespace'>,
): Promise<{
  actors: AuditResource[]
  namespaces: AuditResource[]
  repos: AuditResource[]
  sessions: AuditResource[]
  workspaces: AuditResource[]
  jobs: AuditResource[]
  observedActions: string[]
}> {
  const events = await filterEvents(scope)
  return {
    // Prefer email as the filter value (substring match on actor); fall back to sub.
    actors: collectResources(events, (e) => {
      const key = e.actor.email || e.actor.sub
      return key ? [key] : []
    }).map((r) => {
      const sample = events.find((e) => (e.actor.email || e.actor.sub) === r.id)
      const name = sample?.actor.name?.trim()
      return name && name !== r.id ? { ...r, label: name } : r
    }),
    namespaces: collectDistinct(events, (e) => e.namespace),
    repos: collectDistinct(events, (e) => e.repo),
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
  'resource_uri',
  'namespace',
  'repo',
  'session_id',
  'workspace_id',
  'job_id',
  'method',
  'path',
  'status',
  'message',
  'reason',
  'reason_source',
  'category',
  'change_control_id',
  'signature_id',
  'dataset_base',
  'dataset_head',
  'unverified',
  'detail',
  'event_id',
  'intent_id',
  'phase',
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
        e.resource_uri,
        e.namespace,
        e.repo,
        eventSessionIds(e).join(';'),
        eventWorkspaceIds(e).join(';'),
        eventJobIds(e).join(';'),
        e.method,
        e.path,
        e.phase === 'intent' ? '' : e.status,
        e.message,
        e.reason,
        e.reason_source,
        e.category,
        e.change_control_id,
        e.signature_id,
        e.dataset?.base,
        e.dataset?.head,
        e.unverified ? 'true' : '',
        e.detail ? JSON.stringify(e.detail) : '',
        e.id,
        e.intent_id,
        e.phase,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}
