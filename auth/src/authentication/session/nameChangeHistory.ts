import { getDb } from '../../db/database.js'
import { principals, principalNameHistory } from '../../db/schema.js'
import { eq, and, isNull } from 'drizzle-orm'

/**
 * Principal name timeline (Ticket 22, U11).
 *
 * One deep module for name changes: track closes the open interval and opens a
 * new one; readers resolve current, full history, or the name valid at a time.
 * Admin JSON mapping lives here so routes do not re-derive “current”.
 */

export interface NameHistoryRecord {
  id: number
  principalId: number
  name: string
  validFrom: Date
  validTo: Date | null
  createdAt: Date
}

/** Admin-facing timeline: ISO strings, current name derived from the open row. */
export type AdminNameHistory = {
  currentName: string | null
  history: Array<{ name: string; validFrom: string; validTo: string | null }>
}

function toRecord(row: {
  id: number
  principalId: number
  name: string
  validFrom: Date
  validTo: Date | null
  createdAt: Date
}): NameHistoryRecord {
  return {
    id: row.id,
    principalId: row.principalId,
    name: row.name,
    validFrom: row.validFrom,
    validTo: row.validTo,
    createdAt: row.createdAt,
  }
}

/** Map stored rows to the admin API shape (oldest-first history already ordered). */
export function toAdminNameHistory(records: NameHistoryRecord[]): AdminNameHistory {
  const current = records.find((row) => row.validTo === null)
  return {
    currentName: current?.name ?? null,
    history: records.map((row) => ({
      name: row.name,
      validFrom: row.validFrom.toISOString(),
      validTo: row.validTo ? row.validTo.toISOString() : null,
    })),
  }
}

/** Whether trackNameChange should write, and whether to close the open interval first. */
export type NameHistoryWriteDecision =
  | { kind: 'unchanged' }
  | { kind: 'write'; closeOpenInterval: boolean; previousName?: string; name: string }

/**
 * Name-history write policy for Ticket 47 / U11.
 * Same name with an existing timeline is a no-op; otherwise write (closing the open row when present).
 */
export function decideNameHistoryWrite(input: {
  currentName: string | null
  hasHistory: boolean
  newName: string
}): NameHistoryWriteDecision {
  if (input.currentName === input.newName && input.hasHistory) return { kind: 'unchanged' }
  return {
    kind: 'write',
    closeOpenInterval: Boolean(input.currentName && input.hasHistory),
    previousName: input.currentName ?? undefined,
    name: input.newName,
  }
}

/**
 * Track name change for a Principal.
 *
 * If the name differs from the stored name (or history is missing):
 * 1. Close the current history row (set validTo = now)
 * 2. Update principals.name to new value
 * 3. Insert new history row (validFrom = now, validTo = null)
 */
export async function trackNameChange(
  principalId: number,
  newName: string,
  now: Date = new Date(),
): Promise<{ changed: boolean; previousName?: string }> {
  const db = getDb()

  const [principal] = await db
    .select({ name: principals.name })
    .from(principals)
    .where(eq(principals.id, principalId))

  if (!principal) {
    throw new Error(`Principal ${principalId} not found`)
  }

  const currentName = principal.name

  const [existingHistory] = await db
    .select({ id: principalNameHistory.id })
    .from(principalNameHistory)
    .where(eq(principalNameHistory.principalId, principalId))
    .limit(1)

  const decision = decideNameHistoryWrite({
    currentName,
    hasHistory: existingHistory !== undefined,
    newName,
  })
  if (decision.kind === 'unchanged') return { changed: false }

  if (decision.closeOpenInterval) {
    await db
      .update(principalNameHistory)
      .set({ validTo: now })
      .where(
        and(
          eq(principalNameHistory.principalId, principalId),
          isNull(principalNameHistory.validTo),
        ),
      )
  }

  await db
    .update(principals)
    .set({ name: decision.name })
    .where(eq(principals.id, principalId))

  await db.insert(principalNameHistory).values({
    principalId,
    name: decision.name,
    validFrom: now,
    validTo: null,
    createdAt: now,
  })

  return {
    changed: true,
    previousName: decision.previousName,
  }
}

/** All name intervals for a Principal, oldest first. */
export async function getNameHistory(principalId: number): Promise<NameHistoryRecord[]> {
  const history = await getDb()
    .select()
    .from(principalNameHistory)
    .where(eq(principalNameHistory.principalId, principalId))
    .orderBy(principalNameHistory.validFrom)

  return history.map(toRecord)
}

/** Current display name (open interval: validTo IS NULL). */
export async function getCurrentName(principalId: number): Promise<string | null> {
  const [current] = await getDb()
    .select({ name: principalNameHistory.name })
    .from(principalNameHistory)
    .where(
      and(
        eq(principalNameHistory.principalId, principalId),
        isNull(principalNameHistory.validTo),
      ),
    )
    .limit(1)

  return current?.name ?? null
}

/**
 * Name valid at `at` using half-open intervals: validFrom ≤ t < validTo
 * (validTo null means still open).
 */
export function nameValidAt(
  records: Array<{ name: string; validFrom: Date; validTo: Date | null }>,
  at: Date,
): string | null {
  const atMs = at.getTime()
  const matches = records
    .filter((row) => {
      const from = row.validFrom.getTime()
      const to = row.validTo?.getTime()
      return from <= atMs && (to === undefined || atMs < to)
    })
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())
  return matches[0]?.name ?? null
}

/**
 * Name valid at `timestamp` (validFrom ≤ t < validTo, or validTo null).
 * Used for “name at signing time” on historical signatures.
 */
export async function getNameAtTime(
  principalId: number,
  timestamp: Date,
): Promise<string | null> {
  return nameValidAt(await getNameHistory(principalId), timestamp)
}

/** Full admin timeline for one Principal (history + derived current name). */
export async function getAdminNameHistory(principalId: number): Promise<AdminNameHistory> {
  return toAdminNameHistory(await getNameHistory(principalId))
}
