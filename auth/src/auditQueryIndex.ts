import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { AuditEvent, AuditQuery } from './audit.js'
import { auditActionMatches, upcastAuditEvent } from './auditSchema.js'
import { reportAuditDegradation } from './auditOutage.js'
import { currentClock } from './clock.js'
import { getDb } from './db/database.js'
import { auditQueryIndex, auditQueryIndexCursor } from './db/schema.js'

export type AuditQueryIndexStatus = 'ok' | 'drift' | 'missing'

async function ensureCursorRow(): Promise<void> {
  await getDb()
    .insert(auditQueryIndexCursor)
    .values({ id: 1, auditSeq: 0, status: 'ok' })
    .onConflictDoNothing()
}

/** Upsert one ledger event into the derived query index (not evidence). */
export async function projectAuditQueryIndex(event: AuditEvent, ledgerSeq: number): Promise<void> {
  await ensureCursorRow()
  await getDb()
    .insert(auditQueryIndex)
    .values({
      eventId: event.id,
      ledgerSeq,
      ts: event.ts,
      action: event.action,
      actorSub: event.actor.sub,
      actorEmail: event.actor.email,
      actorName: event.actor.name,
      via: event.via,
      namespace: event.namespace ?? null,
      repo: event.repo ?? null,
      phase: event.phase ?? null,
      intentId: event.intent_id ?? null,
      event,
    })
    .onConflictDoUpdate({
      target: auditQueryIndex.eventId,
      set: {
        ledgerSeq,
        ts: event.ts,
        action: event.action,
        actorSub: event.actor.sub,
        actorEmail: event.actor.email,
        actorName: event.actor.name,
        via: event.via,
        namespace: event.namespace ?? null,
        repo: event.repo ?? null,
        phase: event.phase ?? null,
        intentId: event.intent_id ?? null,
        event,
      },
    })
  await getDb()
    .update(auditQueryIndexCursor)
    .set({ auditSeq: sql`greatest(${auditQueryIndexCursor.auditSeq}, ${ledgerSeq})` })
    .where(eq(auditQueryIndexCursor.id, 1))
}

export async function getAuditQueryIndexCursor(): Promise<number> {
  await ensureCursorRow()
  const rows = await getDb().select().from(auditQueryIndexCursor).where(eq(auditQueryIndexCursor.id, 1)).limit(1)
  return rows[0]?.auditSeq ?? 0
}

export async function auditQueryIndexStatus(): Promise<{
  status: AuditQueryIndexStatus
  auditSeq: number
  detail?: string
}> {
  await ensureCursorRow()
  const rows = await getDb().select().from(auditQueryIndexCursor).where(eq(auditQueryIndexCursor.id, 1)).limit(1)
  const row = rows[0]
  if (!row) return { status: 'missing', auditSeq: 0 }
  const status = (row.status === 'drift' ? 'drift' : 'ok') as AuditQueryIndexStatus
  return { status, auditSeq: row.auditSeq, ...(row.detail ? { detail: row.detail } : {}) }
}

export async function auditQueryIndexIsHealthy(): Promise<boolean> {
  try {
    const s = await auditQueryIndexStatus()
    return s.status === 'ok'
  } catch {
    return false
  }
}

function applyInMemoryFilters(events: AuditEvent[], q: AuditQuery): AuditEvent[] {
  let out = events
  if (!q.includeChain) {
    const resolved = new Set(out.flatMap((e) => (e.phase === 'outcome' && e.intent_id ? [e.intent_id] : [])))
    out = out.filter((e) => !(e.phase === 'intent' && resolved.has(e.id)))
  }
  if (q.allowedNamespaces) {
    const allowed = new Set(q.allowedNamespaces)
    out = out.filter((e) => e.namespace && allowed.has(e.namespace))
  }
  if (q.actor) {
    const a = q.actor.toLowerCase()
    out = out.filter(
      (e) =>
        e.actor.sub.toLowerCase().includes(a) ||
        e.actor.email.toLowerCase().includes(a) ||
        e.actor.name.toLowerCase().includes(a),
    )
  }
  if (q.action) {
    const filter = q.action
    out = out.filter((e) => auditActionMatches(e.action, filter))
  }
  if (q.via) out = out.filter((e) => e.via === q.via)
  if (q.sessionId) {
    const id = q.sessionId
    out = out.filter((e) => typeof e.detail?.session_id === 'string' && e.detail.session_id === id)
  }
  if (q.workspaceId) {
    const id = q.workspaceId
    out = out.filter((e) => {
      if (typeof e.detail?.workspace_id === 'string' && e.detail.workspace_id === id) return true
      const mounts = e.detail?.mounts
      return (
        Array.isArray(mounts) &&
        mounts.some((m) => (m as { workspace_id?: string } | null)?.workspace_id === id)
      )
    })
  }
  if (q.jobId) {
    const id = q.jobId
    out = out.filter((e) => {
      if (typeof e.detail?.job_id === 'string' && e.detail.job_id === id) return true
      const many = e.detail?.job_ids
      return Array.isArray(many) && many.includes(id)
    })
  }
  return out
}

/**
 * Filtered read from the derived index (newest first). Returns null when the index should not be used
 * so callers fall back to an immudb scan. Evidence/verify never use this path.
 */
export async function queryAuditQueryIndex(q: AuditQuery): Promise<AuditEvent[] | null> {
  if (!(await auditQueryIndexIsHealthy())) return null

  const clauses = []
  if (q.namespace) clauses.push(eq(auditQueryIndex.namespace, q.namespace))
  if (q.repo) clauses.push(eq(auditQueryIndex.repo, q.repo))
  if (q.since) clauses.push(gte(auditQueryIndex.ts, q.since))
  if (q.until) clauses.push(lte(auditQueryIndex.ts, q.until))

  const rows = await getDb()
    .select({ event: auditQueryIndex.event })
    .from(auditQueryIndex)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(auditQueryIndex.ts), desc(auditQueryIndex.ledgerSeq))

  const events = rows.map((r) => upcastAuditEvent(r.event as AuditEvent))
  return applyInMemoryFilters(events, q)
}

/**
 * Catch-up projector: upserts ledger rows after the cursor into the index.
 * `readAfter` must return each event with its ledger sequence number.
 */
export async function replayAuditQueryIndex(
  readAfter: (
    seq: number,
    limit?: number,
  ) => Promise<{ rows: Array<{ event: AuditEvent; seq: number }>; scannedTo: number }>,
): Promise<number> {
  let projected = 0
  for (let batch = 0; batch < 50; batch++) {
    const cursor = await getAuditQueryIndexCursor()
    const { rows, scannedTo } = await readAfter(cursor, 200)
    if (scannedTo === cursor && rows.length === 0) break
    for (const row of rows) {
      await projectAuditQueryIndex(row.event, row.seq)
      projected += 1
    }
    if (rows.length === 0 && scannedTo !== cursor) {
      await ensureCursorRow()
      await getDb()
        .update(auditQueryIndexCursor)
        .set({ auditSeq: scannedTo })
        .where(eq(auditQueryIndexCursor.id, 1))
    }
    if (scannedTo === cursor) break
  }
  return projected
}

async function markDrift(detail: string): Promise<void> {
  await ensureCursorRow()
  await getDb()
    .update(auditQueryIndexCursor)
    .set({ status: 'drift', checkedAt: new Date(currentClock.now()), detail })
    .where(eq(auditQueryIndexCursor.id, 1))
  await reportAuditDegradation({
    at: currentClock.now(),
    check: 'query_index',
    requestId: `audit-query-index-${currentClock.now()}`,
    detail,
  }).catch((err) => console.error('[mice-auth] audit query index drift alert failed', err))
}

export async function clearAuditQueryIndexDrift(): Promise<void> {
  await ensureCursorRow()
  await getDb()
    .update(auditQueryIndexCursor)
    .set({ status: 'ok', checkedAt: new Date(currentClock.now()), detail: null })
    .where(eq(auditQueryIndexCursor.id, 1))
}

/**
 * Compare index event ids against the ledger. On mismatch marks drift and alerts.
 * Evidence/verify remains immudb-only.
 */
export async function verifyAuditQueryIndex(opts: {
  ledgerEventIds: () => Promise<string[]>
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const ledgerIds = await opts.ledgerEventIds()
    const indexRows = await getDb().select({ eventId: auditQueryIndex.eventId }).from(auditQueryIndex)
    const indexIds = new Set(indexRows.map((r) => r.eventId))
    if (ledgerIds.length !== indexIds.size) {
      const detail = `audit query index count ${indexIds.size} != ledger ${ledgerIds.length}`
      await markDrift(detail)
      return { ok: false, detail }
    }
    for (const id of ledgerIds) {
      if (!indexIds.has(id)) {
        const detail = `audit query index missing ledger event ${id}`
        await markDrift(detail)
        return { ok: false, detail }
      }
    }
    await clearAuditQueryIndexDrift()
    return { ok: true }
  } catch (err) {
    const detail = `audit query index verify failed: ${String(err)}`
    await markDrift(detail).catch(() => undefined)
    return { ok: false, detail }
  }
}
