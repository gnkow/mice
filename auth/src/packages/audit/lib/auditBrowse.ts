import { currentClock } from '../../shared/index.js'
import { env } from '../../shared/index.js'
import { actorFromUser } from './auditActor.js'
import { appendAudit } from './auditAppend.js'
import { EMPTY_AUDIT_CHANGE } from './auditChange.js'
import { auditActionLabel, knownAuditActions } from './auditLabels.js'
import { orphanAgingThresholdMs, orphanListAnnotation } from './auditOrphanAlert.js'
import { auditEventsToCsv, auditFacets, queryAudit, queryAuditForExport } from './auditQuery.js'
import { buildAuditExportBundle } from './auditExportBundle.js'
import { auditEventsToPdf, auditExportPrivateKeyPem } from './auditExport.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { AuditActor, AuditEvent, AuditQuery, AuditVia } from './auditTypes.js'

/** List page: query + audit-of-audit browse + orphan annotations. */
export async function browseAuditEvents(input: {
  query: AuditQuery
  user: SessionUser
  via: AuditVia
  method: string
  path: string
  cursor?: string
  limit?: number
}): Promise<{
  events: Array<AuditEvent & { action_label: string } & Record<string, unknown>>
  nextCursor: string | null
  orphan_aging_sec: number
}> {
  const { events, nextCursor } = await queryAudit({
    ...input.query,
    cursor: input.cursor,
    limit: input.limit,
  })
  // Best-effort audit-of-audit summary; a failed append must not break the read.
  await appendAudit({
    actor: actorFromUser(input.user),
    via: input.via,
    method: input.method,
    path: input.path,
    status: 200,
    action: 'audit.browse',
    change: EMPTY_AUDIT_CHANGE,
    message: `Browsed ${events.length} audit events`,
    detail: {
      rows: events.length,
      has_more: Boolean(nextCursor),
      filters: { ...input.query, allowedNamespaces: undefined },
    },
  })
  const now = currentClock.now()
  const thresholdMs = orphanAgingThresholdMs()
  return {
    events: events.map((e) => ({
      ...e,
      action_label: auditActionLabel(e.action),
      ...orphanListAnnotation(e, now, thresholdMs),
    })),
    nextCursor,
    orphan_aging_sec: Math.round(thresholdMs / 1000),
  }
}

/** Facet dropdowns for the same AuthZ scope as the list. */
export async function browseAuditFacets(query: AuditQuery) {
  const f = await auditFacets({
    namespace: query.namespace,
    allowedNamespaces: query.allowedNamespaces,
  })
  const actions = query.excludeActions?.length
    ? knownAuditActions().filter((a) => !query.excludeActions!.includes(a.value))
    : knownAuditActions()
  return {
    actions,
    actors: f.actors,
    namespaces: f.namespaces,
    repos: f.repos,
    sessions: f.sessions,
    workspaces: f.workspaces,
    jobs: f.jobs,
    orphan_aging_sec: env.auditOrphanAlertSec,
  }
}

export async function exportAuditCsv(query: AuditQuery): Promise<{
  csv: string
  events: AuditEvent[]
  truncated: boolean
}> {
  const { events, truncated } = await queryAuditForExport(query)
  return { csv: auditEventsToCsv(events), events, truncated }
}

export async function exportAuditPdf(query: AuditQuery): Promise<
  | { ok: false; error: string; status: 503 }
  | { ok: true; pdf: Buffer; events: AuditEvent[]; truncated: boolean }
> {
  if (!auditExportPrivateKeyPem()) {
    return {
      ok: false,
      error: 'Audit export signing key is not configured (set AUDIT_EXPORT_PRIVATE_KEY)',
      status: 503,
    }
  }
  const { events, truncated } = await queryAuditForExport(query)
  return { ok: true, pdf: auditEventsToPdf(events), events, truncated }
}

export async function exportAuditBundle(input: {
  query: AuditQuery
  exportedBy: AuditActor
  method: string
  path: string
  via: AuditVia
}): Promise<
  | { ok: false; error: string; status: 503 }
  | { ok: true; bundle: Record<string, unknown> }
> {
  const query = { ...input.query, includeChain: true }
  const filters = { ...input.query, allowedNamespaces: undefined, includeChain: undefined }
  const logged = await appendAudit({
    actor: input.exportedBy,
    via: input.via,
    method: input.method,
    path: input.path,
    status: 200,
    action: 'audit.export',
    change: EMPTY_AUDIT_CHANGE,
    message: 'Exported a audit bundle',
    detail: { format: 'bundle', filters },
  })
  if (!logged) return { ok: false, error: 'Audit store unavailable; the export was refused', status: 503 }
  const built = await buildAuditExportBundle(query, input.exportedBy, filters)
  if (!built.ok) return { ok: false, error: built.error, status: 503 }
  return { ok: true, bundle: built.bundle }
}
