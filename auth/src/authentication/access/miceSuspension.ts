import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../../db/database.js'
import { principalFlagHistory, principals, webSessions } from '../../db/schema.js'
import { canonicalIssuer, type PrincipalId } from '../session/principal.js'

export const SUSPENDED = 'suspended'

export type FlagChange = {
  reason: string
  actor: PrincipalId
}

export type FlagHistoryEntry = {
  flag: string
  action: 'set' | 'lift'
  reason: string
  actor: string
  at: string
}

/** True when this Principal's Mice flags include `suspended`. */
export async function isSuspended(principal: PrincipalId): Promise<boolean> {
  const [row] = await getDb()
    .select({ flags: principals.flags })
    .from(principals)
    .where(and(eq(principals.iss, canonicalIssuer(principal.iss)), eq(principals.sub, principal.sub)))
    .limit(1)
  return row?.flags.includes(SUSPENDED) ?? false
}

async function loadPrincipal(principal: PrincipalId) {
  const [row] = await getDb()
    .select({ id: principals.id, flags: principals.flags })
    .from(principals)
    .where(and(eq(principals.iss, canonicalIssuer(principal.iss)), eq(principals.sub, principal.sub)))
    .limit(1)
  return row
}

async function recordFlag(principalId: number, action: 'set' | 'lift', change: FlagChange): Promise<void> {
  await getDb().insert(principalFlagHistory).values({
    principalId,
    flag: SUSPENDED,
    action,
    reason: change.reason,
    actorIss: canonicalIssuer(change.actor.iss),
    actorSub: change.actor.sub,
    at: new Date(),
  })
}

/** Removes the Mice `suspended` flag and records the lift. The Principal must already exist. */
export async function liftSuspension(principal: PrincipalId, change: FlagChange): Promise<boolean> {
  const row = await loadPrincipal(principal)
  if (!row) return false
  await getDb()
    .update(principals)
    .set({ flags: row.flags.filter((flag) => flag !== SUSPENDED) })
    .where(eq(principals.id, row.id))
  await recordFlag(row.id, 'lift', change)
  return true
}

/** Adds the Mice `suspended` flag, ends that Principal's web Sessions, and records the set. */
export async function suspendPrincipal(principal: PrincipalId, change: FlagChange): Promise<boolean> {
  const row = await loadPrincipal(principal)
  if (!row) return false
  if (!row.flags.includes(SUSPENDED)) {
    await getDb()
      .update(principals)
      .set({ flags: [...row.flags, SUSPENDED] })
      .where(eq(principals.id, row.id))
    await getDb().delete(webSessions).where(eq(webSessions.principalId, row.id))
  }
  await recordFlag(row.id, 'set', change)
  return true
}

/** Flag changes for one Principal, oldest first. Null when the Principal does not exist. */
export async function suspensionHistory(principal: PrincipalId): Promise<FlagHistoryEntry[] | null> {
  const row = await loadPrincipal(principal)
  if (!row) return null
  const rows = await getDb()
    .select()
    .from(principalFlagHistory)
    .where(eq(principalFlagHistory.principalId, row.id))
    .orderBy(asc(principalFlagHistory.id))
  return rows.map((entry) => ({
    flag: entry.flag,
    action: entry.action === 'lift' ? 'lift' : 'set',
    reason: entry.reason,
    actor: `${entry.actorIss}|${entry.actorSub}`,
    at: entry.at.toISOString(),
  }))
}
