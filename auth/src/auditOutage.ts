import { desc, isNull } from 'drizzle-orm'
import { listInstanceAdmins } from './authzInstanceStore.js'
import { getDb } from './db/database.js'
import { auditOutages } from './db/schema.js'
import { emitNotification } from './notifications.js'

const paperProcedure = 'validation-pack:audit-outage'

export type AuditOutage = {
  startedAt: number
  endedAt?: number
  check: string
  requestId: string
  paperProcedure: string
}

/** Closes the open incident when the audit store answers again. */
export async function closeAuditOutage(at: number): Promise<void> {
  await getDb().update(auditOutages).set({ endedAt: new Date(at) }).where(isNull(auditOutages.endedAt))
}

/**
 * Opens an incident for an unavailable or degraded audit store.
 * A second failure in the same outage keeps the first. Returns true when a new incident opened.
 */
export async function noteAuditOutage(input: {
  at: number
  check: string
  requestId: string
}): Promise<boolean> {
  if (await currentAuditOutage()) return false
  await getDb().insert(auditOutages).values({
    startedAt: new Date(input.at),
    check: input.check,
    requestId: input.requestId,
    paperProcedure,
  })
  return true
}

/** Notifies instance admins once for a newly opened audit outage. */
export async function alertAuditDegradation(input: {
  at: number
  check: string
  detail?: string
}): Promise<void> {
  const admins = await listInstanceAdmins()
  if (admins.length === 0) return
  const day = new Date(input.at).toISOString().slice(0, 10)
  await emitNotification({
    id: `audit-outage:${day}:${input.check}`,
    category: 'security',
    title: 'Audit store degraded',
    summary: input.detail
      ? `Audit (immudb) failed during ${input.check}: ${input.detail}`
      : `Audit (immudb) failed during ${input.check}. Mutations are refused until it recovers.`,
    href: '/settings#audit-health',
    audience: 'personal',
    recipients: admins.map((admin) => ({ iss: admin.iss, sub: admin.sub })),
    createdAt: new Date(input.at).toISOString(),
  })
}

/**
 * Records degradation when the audit store fails a check, and alerts operators on a new incident.
 * Idempotent within an open outage.
 */
export async function reportAuditDegradation(input: {
  at: number
  check: string
  requestId: string
  detail?: string
}): Promise<AuditOutage | null> {
  const opened = await noteAuditOutage(input)
  if (opened) {
    await alertAuditDegradation({ at: input.at, check: input.check, detail: input.detail }).catch((err) =>
      console.error('[mice-auth] audit degradation alert failed', err),
    )
  }
  return currentAuditOutage()
}

function toIncident(row: typeof auditOutages.$inferSelect): AuditOutage {
  return {
    startedAt: row.startedAt.getTime(),
    ...(row.endedAt ? { endedAt: row.endedAt.getTime() } : {}),
    check: row.check,
    requestId: row.requestId,
    paperProcedure: row.paperProcedure,
  }
}

/** The incident that is still open, if the audit store has not answered since it started. */
export async function currentAuditOutage(): Promise<AuditOutage | null> {
  const [row] = await getDb().select().from(auditOutages).where(isNull(auditOutages.endedAt)).limit(1)
  return row ? toIncident(row) : null
}

/** Incidents newest-first (open incidents included). */
export async function listAuditOutages(limit = 50): Promise<AuditOutage[]> {
  const rows = await getDb()
    .select()
    .from(auditOutages)
    .orderBy(desc(auditOutages.id))
    .limit(limit)
  return rows.map(toIncident)
}

/** Production attestation: operators must set IMMUDB_HA=true for a non-single-instance deploy. */
export function immudbHaAttested(src: NodeJS.ProcessEnv = process.env): boolean {
  return src.IMMUDB_HA === 'true'
}

/** Operator-facing HA attestation for readiness / admin audit-health. */
export function immudbHaStatus(src: NodeJS.ProcessEnv = process.env): {
  attested: boolean
  detail: string
} {
  const attested = immudbHaAttested(src)
  return {
    attested,
    detail: attested
      ? 'IMMUDB_HA=true (production requires a non-single-instance audit store)'
      : 'IMMUDB_HA is not attested; production startup refuses a single immudb instance',
  }
}
