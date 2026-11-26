import type { Context, Hono } from 'hono'
import { actorFromUser } from './auditActor.js'
import { browseAuditEvents, browseAuditFacets, exportAuditBundle, exportAuditCsv, exportAuditPdf } from './auditBrowse.js'
import { EMPTY_AUDIT_CHANGE, requireAuditChange } from './auditChange.js'
import { rebuildLineageFromOxen } from './auditLineageRebuild.js'
import { resolveAuditQueryScope } from './auditQueryScope.js'
import { acknowledgeAuditBreak, verifyAudit } from './auditVerify.js'
import { instanceGate } from '../../authz/http.js'
import type { AuditDep } from '../../shared/index.js'
import { authorizeLineageQuery, authorizeLineageRebuild } from '../../authz/index.js'
import { queryLineage, LineageKind } from '../../namespaces/index.js'
import { guarded } from '../../authentication/session.js'
import type { SessionUser } from '../../authentication/principal.js'

function queryParamsFromContext(c: Context) {
  return {
    namespace: c.req.query('namespace') || undefined,
    repo: c.req.query('repo') || undefined,
    actor: c.req.query('actor') || undefined,
    action: c.req.query('action') || undefined,
    focus: c.req.query('focus') || undefined,
    since: c.req.query('since') || undefined,
    until: c.req.query('until') || undefined,
    sessionId: c.req.query('session_id') || undefined,
    workspaceId: c.req.query('workspace_id') || undefined,
    jobId: c.req.query('job_id') || undefined,
    via: c.req.query('via') || undefined,
    includeChain: c.req.query('include') === 'chain',
    orphansOnly: c.req.query('orphans') === '1' || c.req.query('orphans') === 'true',
  }
}

async function resolveAuditQuery(
  c: Context,
  session: SessionUser,
): Promise<{ ok: false; response: Response } | { ok: true; query: import('./auditTypes.js').AuditQuery }> {
  const resolved = await resolveAuditQueryScope(session, queryParamsFromContext(c))
  if ('error' in resolved) {
    return { ok: false, response: c.json({ error: resolved.error }, resolved.status) }
  }
  return { ok: true, query: resolved.query }
}

/** Audit log query, facets, CSV export, and the file lineage graph and its rebuild. */
export function registerAuditRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get('/auth/audit', guarded({}, async ({ c, user, via }) => {
    const r = await resolveAuditQuery(c, user)
    if (!r.ok) return r.response
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    const page = await browseAuditEvents({
      query: r.query,
      user,
      via: via === 'pat' ? 'pat' : 'session',
      method: c.req.method,
      path: c.req.path,
      cursor: c.req.query('cursor') || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    })
    return c.json(page)
  }))

  app.get('/auth/audit/facets', guarded({}, async ({ c, user }) => {
    const r = await resolveAuditQuery(c, user)
    if (!r.ok) return r.response
    return c.json(await browseAuditFacets(r.query))
  }))

  app.get('/auth/audit/export.csv', guarded({}, async ({ c, user, audit }) => {
    const r = await resolveAuditQuery(c, user)
    if (!r.ok) return r.response
    const { csv, events, truncated } = await exportAuditCsv(r.query)
    await audit({
      action: 'audit.export',
      change: EMPTY_AUDIT_CHANGE,
      message: `Exported ${events.length} audit events to CSV`,
      detail: { rows: events.length, truncated, filters: { ...r.query, allowedNamespaces: undefined } },
    })
    const day = new Date().toISOString().slice(0, 10)
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="audit-${day}.csv"`)
    c.header('Cache-Control', 'no-store')
    if (truncated) c.header('X-Audit-Truncated', 'true')
    return c.body(csv)
  }))

  app.get('/auth/audit/export.pdf', guarded({}, async ({ c, user, audit }) => {
    const r = await resolveAuditQuery(c, user)
    if (!r.ok) return r.response
    const exported = await exportAuditPdf(r.query)
    if (!exported.ok) return c.json({ error: exported.error }, exported.status)
    await audit({
      action: 'audit.export',
      change: EMPTY_AUDIT_CHANGE,
      message: `Exported ${exported.events.length} audit events to PDF`,
      detail: {
        rows: exported.events.length,
        truncated: exported.truncated,
        format: 'pdf',
        filters: { ...r.query, allowedNamespaces: undefined },
      },
    })
    const day = new Date().toISOString().slice(0, 10)
    c.header('Content-Type', 'application/pdf')
    c.header('Content-Disposition', `attachment; filename="audit-${day}.pdf"`)
    c.header('Cache-Control', 'no-store')
    if (exported.truncated) c.header('X-Audit-Truncated', 'true')
    return c.body(Uint8Array.from(exported.pdf))
  }))

  app.get('/auth/audit/export.bundle', guarded({}, async ({ c, user, via }) => {
    const r = await resolveAuditQuery(c, user)
    if (!r.ok) return r.response
    const built = await exportAuditBundle({
      query: r.query,
      exportedBy: actorFromUser(user),
      method: c.req.method,
      path: c.req.path,
      via: via === 'pat' ? 'pat' : 'session',
    })
    if (!built.ok) return c.json({ error: built.error }, built.status)
    const day = new Date().toISOString().slice(0, 10)
    c.header('Content-Disposition', `attachment; filename="audit-bundle-${day}.json"`)
    c.header('Cache-Control', 'no-store')
    return c.json(built.bundle)
  }))

  app.get('/auth/audit/verify', guarded({}, async ({ c, user }) => {
    const r = await resolveAuditQuery(c, user)
    if (!r.ok) return r.response
    const v = await verifyAudit()
    c.header('Cache-Control', 'no-store')
    return c.json(
      v.ok
        ? { ok: true, events: v.events, verifiedAt: v.verifiedAt, tip: { txid: v.head, root: v.root } }
        : { ok: false, events: v.events, verifiedAt: v.verifiedAt, firstBreak: v.firstBreak },
    )
  }))

  app.post('/auth/audit/acknowledge', guarded({ gate: instanceGate('instance.admin'), mutates: true, action: 'audit.break.acknowledge', reason: true, body: 'optional' }, async ({ c, audit }) => {
    const ack = await acknowledgeAuditBreak()
    if (!ack) return c.json({ error: 'The audit chain verifies; there is nothing to acknowledge' }, 409)
    await audit({
      action: 'audit.break.acknowledge',
      change: requireAuditChange({ [`break.${ack.seq}.acknowledged`]: false }, { [`break.${ack.seq}.acknowledged`]: true }),
      message: `Acknowledged audit chain break at event ${ack.seq}`,
      detail: { seq: ack.seq, reason: ack.reason },
    })
    return c.json({ ok: true, acknowledged: ack })
  }))

  app.get('/auth/lineage', guarded({}, async ({ c, user: session }) => {
    const namespace = c.req.query('namespace') || undefined
    const repo = c.req.query('repo') || undefined
    const gate = await authorizeLineageQuery(session, namespace, repo)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    if (!namespace || !repo) {
      return c.json({ error: 'namespace and repo are required' }, 400)
    }

    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    const depthRaw = c.req.query('depth')
    const depth = depthRaw ? Number(depthRaw) : undefined
    const directionRaw = c.req.query('direction')
    const direction =
      directionRaw === 'ancestors' ||
      directionRaw === 'descendants' ||
      directionRaw === 'both'
        ? directionRaw
        : undefined
    const kindRaw = c.req.query('kind')
    const kind = kindRaw as LineageKind | undefined

    const { operations, nextCursor } = await queryLineage({
      namespace,
      repo,
      path: c.req.query('path') || undefined,
      contentHash: c.req.query('contentHash') || undefined,
      direction,
      depth: Number.isFinite(depth) ? depth : undefined,
      since: c.req.query('since') || undefined,
      until: c.req.query('until') || undefined,
      cursor: c.req.query('cursor') || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      kind,
      jobId: c.req.query('jobId') || undefined,
      commit: c.req.query('commit') || undefined,
    })
    return c.json({ operations, nextCursor })
  }))

  app.post('/auth/lineage/rebuild', guarded({ mutates: true, action: 'lineage.rebuild', reason: true, body: 'json', invalidBody: 'Invalid JSON body' }, async ({ c, user: session, body: raw }) => {
    const body = raw as {
      namespace?: string
      repo?: string
      branch?: string
      path?: string
    }
    const namespace = body.namespace?.trim()
    const repo = body.repo?.trim()
    const path = body.path?.trim()
    const branch = body.branch?.trim() || 'main'
    if (!namespace || !repo || !path) {
      return c.json({ error: 'namespace, repo, and path are required' }, 400)
    }

    const gate = await authorizeLineageRebuild(session, namespace, repo)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }

    const rebuilt = await rebuildLineageFromOxen({ namespace, repo, branch, path })
    if (!rebuilt.ok) return c.json({ error: rebuilt.error }, rebuilt.status)
    const created = rebuilt.created
    await auditMutation(c, session, 'session', {
      action: 'lineage.rebuild',
      change: created.length
        ? requireAuditChange(null, { lineage_operations: created.map((op) => op.id).sort() })
        : EMPTY_AUDIT_CHANGE,
      namespace,
      repo,
      message: `Rebuilt lineage for ${path}`,
      detail: { branch, path, created: created.length },
    })
    return c.json({
      created: created.length,
      operations: created,
      idempotent: created.length === 0,
    })
  }))
}
