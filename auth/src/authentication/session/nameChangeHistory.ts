import { getDb } from '../../db/database.js'
import { principals, principalNameHistory } from '../../db/schema.js'
import { eq, and, isNull, desc } from 'drizzle-orm'

/**
 * Name Change History Tracking (Ticket 22, U11)
 * 
 * Tracks name changes per Principal for audit trail. When a person's legal name
 * changes (marriage, legal name change), the signature captured "Dr. Jane Smith"
 * but later the IdP returns "Dr. Jane Jones" for the same iss|sub.
 * 
 * Without visible history, auditors reviewing 5-year-old signatures see two
 * apparently different people. Name history ensures auditors understand that
 * "Dr. Jane Smith (2021)" and "Dr. Jane Jones (2026)" are the same person.
 * 
 * Related:
 * - .scratch/authentication/issues/22-name-change-history.md
 * - Round 8 decision U11
 */

export interface NameHistoryRecord {
  id: number
  principalId: number
  name: string
  validFrom: Date
  validTo: Date | null
  createdAt: Date
}

/**
 * Track name change for a Principal.
 * 
 * If the name differs from the stored name:
 * 1. Close the current history row (set validTo = now)
 * 2. Update principals.name to new value
 * 3. Insert new history row (validFrom = now, validTo = null)
 * 
 * If this is the first time we see a name for this principal,
 * just insert the first history row.
 */
export async function trackNameChange(
  principalId: number,
  newName: string,
  now: Date = new Date()
): Promise<{ changed: boolean; previousName?: string }> {
  const db = getDb()
  
  // Get current principal name
  const [principal] = await db
    .select({ name: principals.name })
    .from(principals)
    .where(eq(principals.id, principalId))
  
  if (!principal) {
    throw new Error(`Principal ${principalId} not found`)
  }
  
  const currentName = principal.name
  
  // Check if there's any history for this principal
  const [existingHistory] = await db
    .select({ id: principalNameHistory.id })
    .from(principalNameHistory)
    .where(eq(principalNameHistory.principalId, principalId))
    .limit(1)
  
  const hasHistory = existingHistory !== undefined
  
  // If no change and we already have history, do nothing
  if (currentName === newName && hasHistory) {
    return { changed: false }
  }
  
  // Name changed (or first time creating history)
  
  // If there was a previous name with history, close its history row
  if (currentName && hasHistory) {
    await db
      .update(principalNameHistory)
      .set({ validTo: now })
      .where(
        and(
          eq(principalNameHistory.principalId, principalId),
          isNull(principalNameHistory.validTo)
        )
      )
  }
  
  // Update principal's current name
  await db
    .update(principals)
    .set({ name: newName })
    .where(eq(principals.id, principalId))
  
  // Insert new history row
  await db.insert(principalNameHistory).values({
    principalId,
    name: newName,
    validFrom: now,
    validTo: null, // Current name
    createdAt: now,
  })
  
  return {
    changed: hasHistory ? true : true, // Always report as changed if it's the first history entry
    previousName: currentName ?? undefined,
  }
}

/**
 * Get name history for a Principal.
 * Returns all name changes in chronological order (oldest first).
 */
export async function getNameHistory(principalId: number): Promise<NameHistoryRecord[]> {
  const history = await getDb()
    .select()
    .from(principalNameHistory)
    .where(eq(principalNameHistory.principalId, principalId))
    .orderBy(principalNameHistory.validFrom)
  
  return history.map(row => ({
    id: row.id,
    principalId: row.principalId,
    name: row.name,
    validFrom: row.validFrom,
    validTo: row.validTo,
    createdAt: row.createdAt,
  }))
}

/**
 * Get the current name for a Principal.
 * Returns the most recent name (validTo = null).
 */
export async function getCurrentName(principalId: number): Promise<string | null> {
  const [current] = await getDb()
    .select({ name: principalNameHistory.name })
    .from(principalNameHistory)
    .where(
      and(
        eq(principalNameHistory.principalId, principalId),
        isNull(principalNameHistory.validTo)
      )
    )
    .limit(1)
  
  return current?.name ?? null
}

/**
 * Get the name that was valid at a specific time.
 * Used to show "name at signing time" for historical signatures.
 */
export async function getNameAtTime(
  principalId: number,
  timestamp: Date
): Promise<string | null> {
  const [nameAtTime] = await getDb()
    .select({ name: principalNameHistory.name })
    .from(principalNameHistory)
    .where(
      and(
        eq(principalNameHistory.principalId, principalId),
        eq(principalNameHistory.validFrom, timestamp) // validFrom <= timestamp
      )
    )
    .orderBy(desc(principalNameHistory.validFrom))
    .limit(1)
  
  return nameAtTime?.name ?? null
}
