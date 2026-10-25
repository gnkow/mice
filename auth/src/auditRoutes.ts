import type { Context, Hono } from 'hono'
import { acknowledgeAuditBreak, actorFromUser, appendAudit, auditEventsToCsv, auditFacets, buildAuditExportBundle, queryAudit, queryAuditForExport, type AuditQuery } from './audit.js'
import { instanceGate } from './decisionHttp.js'
import { auditActionLabel, knownAuditActions } from './auditLabels.js'
import { authorizeAuditQuery, authorizeLineageQuery, authorizeLineageRebuild } from './authz.js'
import { env } from './env.js'
import { deriveOpsFromPathHistory, queryLineage, type LineageKind, type PathVersionHint } from './lineage.js'
import { guarded } from './routeGuard.js'
import type { AuditDep } from './routeDeps.js'
import type { SessionUser } from './session.js'

/** The caller's audit scope + filters; returns a Response on denial. */
async function resolveAuditQuery(c: Context, session: SessionUser): Promise<{ error: Response } | { query: AuditQuery }> {
  let namespace = c.req.query('namespace') || undefined
  const gate = await authorizeAuditQuery(session, namespace)
  if (!gate.allow) {
    return { error: c.json({ error: gate.reason ?? 'Forbidden' }, 403) }
  }
  if (gate.forceNamespace) namespace = gate.forceNamespace
  const via = c.req.query('via')
  return {
    query: {
      actor: c.req.query('actor') || undefined,
      namespace,
      repo: c.req.query('repo') || undefined,
      action: c.req.query('action') || undefined,
      since: c.req.query('since') || undefined,
      until: c.req.query('until') || undefined,
      sessionId: c.req.query('session_id') || undefined,
      workspaceId: c.req.query('workspace_id') || undefined,
      jobId: c.req.query('job_id') || undefined,
      via: via === 'session' || via === 'pat' ? via : undefined,
      allowedNamespaces: gate.ownedOnly,
      includeChain: c.req.query('include') === 'chain',
    },
  }
}

/** Audit log query, facets, CSV export, and the file lineage graph and its rebuild. */
export function registerAuditRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  /** Query append-only audit log (session required). */
  app.get('/auth/audit', guarded({}, async ({ c, user }) => {
    const r = await resolveAuditQuery(c, user)
    if ('error' in r) return r.error
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    const { events, nextCursor } = await queryAudit({
      ...r.query,
      cursor: c.req.query('cursor') || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    })
    return c.json({
      events: events.map((e) => ({ ...e, action_label: auditActionLabel(e.action) })),
      nextCursor,
    })
  }))

  /** Filter dropdown options: known actions plus sessions/workspaces/jobs seen in the log. */
  app.get('/auth/audit/facets', guarded({}, async ({ c, user }) => {
    const r = await resolveAuditQuery(c, user)
    if ('error' in r) return r.error
    const f = await auditFacets({
      namespace: r.query.namespace,
      allowedNamespaces: r.query.allowedNamespaces,
    })
    return c.json({
      actions: knownAuditActions(),
      sessions: f.sessions,
      workspaces: f.workspaces,
      jobs: f.jobs,
    })
  }))

  /** CSV export honouring the same filters and scope as the list. */
  app.get('/auth/audit/export.csv', guarded({}, async ({ c, user, audit }) => {
    const r = await resolveAuditQuery(c, user)
    if ('error' in r) return r.error
    const { events, truncated } = await queryAuditForExport(r.query)
    const csv = auditEventsToCsv(events)
    await audit({
      action: 'audit.export',
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

  /**
   * Signed evidence bundle: the events (chain order, with hashes), the checkpoints, a fresh
   * verification result and the public keys. Same scope as the list; the export is audited
   * first, and refused when that cannot be recorded.
   */
  app.get('/auth/audit/export.bundle', guarded({}, async ({ c, user, via }) => {
    const r = await resolveAuditQuery(c, user)
    if ('error' in r) return r.error
    const query = { ...r.query, includeChain: true }
    const filters = { ...r.query, allowedNamespaces: undefined, includeChain: undefined }
    const logged = await appendAudit({
      actor: actorFromUser(user),
      via,
      method: c.req.method,
      path: c.req.path,
      status: 200,
      action: 'audit.export',
      message: 'Exported a audit bundle',
      detail: { format: 'bundle', filters },
    })
    if (!logged) return c.json({ error: 'Audit store unavailable; the export was refused' }, 503)
    const built = await buildAuditExportBundle(query, { sub: user.sub, iss: user.iss, email: user.email, name: user.name }, filters)
    if (!built.ok) return c.json({ error: built.error }, 503)
    const day = new Date().toISOString().slice(0, 10)
    c.header('Content-Disposition', `attachment; filename="audit-bundle-${day}.json"`)
    c.header('Cache-Control', 'no-store')
    return c.json(built.bundle)
  }))

  /**
   * An instance admin accepts a failed chain verification so dataset mutations resume. The break
   * stays in the trail; the acknowledgement (who, why, which break) is itself an audited event.
   */
  app.post('/auth/audit/acknowledge', guarded({ gate: instanceGate('instance.admin'), mutates: true, reason: true, body: 'optional' }, async ({ c, audit }) => {
    const ack = await acknowledgeAuditBreak()
    if (!ack) return c.json({ error: 'The audit chain verifies; there is nothing to acknowledge' }, 409)
    await audit({
      action: 'audit.break.acknowledge',
      message: `Acknowledged audit chain break at event ${ack.seq}`,
      detail: { seq: ack.seq, reason: ack.reason },
    })
    return c.json({ ok: true, acknowledged: ack })
  }))

  /** Query file lineage graph for a repo (session required; repo read). */
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

  /**
   * Rebuild derived lineage for a path from oxen path-version history.
   * Body: { namespace, repo, branch?, path }
   */
  app.post('/auth/lineage/rebuild', guarded({ mutates: true, body: 'json', invalidBody: 'Invalid JSON body' }, async ({ c, user: session, body: raw }) => {
    const body = raw as {
      namespace?: string
      repo?: string
      branch?: string
      path?: string
    }
    const namespace = body.namespace?.trim()
    const repo = body.repo?.trim()
    const path = body.path?.trim()
    const branch = (body.branch?.trim() || 'main')
    if (!namespace || !repo || !path) {
      return c.json({ error: 'namespace, repo, and path are required' }, 400)
    }

    const gate = await authorizeLineageRebuild(session, namespace, repo)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }

    const resource = path
      .split('/')
      .filter(Boolean)
      .map((p) => encodeURIComponent(p))
      .join('/')
    const repoApi = `${env.oxenUpstream}/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`
    const looksLikeCommitId = /^[0-9a-f]{16,64}$/i.test(branch)
    const branchVersionsUrl = `${repoApi}/branches/${encodeURIComponent(branch)}/versions/${resource}?page=1&page_size=100`
    const historyUrl = `${repoApi}/commits/history/${[branch, ...path.split('/').filter(Boolean)].map(encodeURIComponent).join('/')}?page=1&page_size=100`

    type VersionRow = {
      commit?: { id?: string; timestamp?: string }
      resource?: { path?: string; version?: string }
    }
    type HistoryRow = {
      id?: string
      timestamp?: string
    }

    async function fetchJson(url: string): Promise<{ ok: boolean; status: number; json: unknown }> {
      try {
        const upstream = await fetch(url)
        let json: unknown = null
        try {
          json = await upstream.json()
        } catch {
          json = null
        }
        return { ok: upstream.ok, status: upstream.status, json }
      } catch (err) {
        console.error('[mice-auth] lineage rebuild fetch failed', err)
        return { ok: false, status: 502, json: null }
      }
    }

    let hints: PathVersionHint[] = []
    if (!looksLikeCommitId) {
      const branchRes = await fetchJson(branchVersionsUrl)
      if (branchRes.ok && branchRes.json && typeof branchRes.json === 'object') {
        const rows =
          (branchRes.json as { versions?: VersionRow[] }).versions ?? []
        // API returns newest-first typically; normalize to oldest-first.
        hints = rows
          .map((v) => ({
            path: v.resource?.path || path,
            contentHash: v.resource?.version,
            commitId: v.commit?.id,
            ts: v.commit?.timestamp,
          }))
          .reverse()
      } else if (branchRes.status !== 404 && branchRes.status !== 400) {
        return c.json(
          { error: `oxen versions failed (${branchRes.status})` },
          502,
        )
      }
    }

    if (hints.length === 0) {
      const histRes = await fetchJson(historyUrl)
      if (!histRes.ok) {
        return c.json(
          { error: `oxen versions failed (${histRes.status})` },
          502,
        )
      }
      if (!histRes.json || typeof histRes.json !== 'object') {
        return c.json({ error: 'Invalid oxen versions response' }, 502)
      }
      const commits =
        (histRes.json as { commits?: HistoryRow[] }).commits ?? []
      hints = commits
        .map((commit) => ({
          path,
          commitId: commit.id,
          ts: commit.timestamp,
        }))
        .reverse()
    }

    const created = await deriveOpsFromPathHistory(namespace, repo, branch, hints)
    await auditMutation(c, session, 'session', {
      action: 'lineage.rebuild',
      namespace,
      repo,
      message: `Rebuilt lineage for ${path}`,
      detail: { branch, path, created: created.length },
    })
    return c.json({
      created: created.length,
      operations: created,
      // Re-running rebuild is a no-op once each version has a single producer.
      idempotent: created.length === 0,
    })
  }))
}
