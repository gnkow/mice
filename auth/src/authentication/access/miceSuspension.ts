import { and, asc, eq } from 'drizzle-orm'
import { getDb, inTransaction } from '../../db/database.js'
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

type PrincipalRow = { id: number; flags: string[] }

async function loadPrincipal(principal: PrincipalId): Promise<PrincipalRow | null> {
  const [row] = await getDb()
    .select({ id: principals.id, flags: principals.flags })
    .from(principals)
    .where(and(eq(principals.iss, canonicalIssuer(principal.iss)), eq(principals.sub, principal.sub)))
    .limit(1)
  return row ?? null
}

/**
 * Deep seam for Mice flag mutations: flag write, session wipe (on set), and history
 * land in one transaction so a partial update cannot leave access and history disagreeing.
 */
async function applyFlagChange(
  action: 'set' | 'lift',
  principal: PrincipalId,
  change: FlagChange,
): Promise<boolean> {
  const row = await loadPrincipal(principal)
  if (!row) return false

  await inTransaction(async (tx) => {
    if (action === 'set') {
      if (!row.flags.includes(SUSPENDED)) {
        await tx
          .update(principals)
          .set({ flags: [...row.flags, SUSPENDED] })
          .where(eq(principals.id, row.id))
        await tx.delete(webSessions).where(eq(webSessions.principalId, row.id))
      }
    } else {
      await tx
        .update(principals)
        .set({ flags: row.flags.filter((flag) => flag !== SUSPENDED) })
        .where(eq(principals.id, row.id))
    }

    await tx.insert(principalFlagHistory).values({
      principalId: row.id,
      flag: SUSPENDED,
      action,
      reason: change.reason,
      actorIss: canonicalIssuer(change.actor.iss),
      actorSub: change.actor.sub,
      at: new Date(),
    })
  })
  return true
}

/** True when this Principal's Mice flags include `suspended`. */
export async function isSuspended(principal: PrincipalId): Promise<boolean> {
  const row = await loadPrincipal(principal)
  return row?.flags.includes(SUSPENDED) ?? false
}

/** Removes the Mice `suspended` flag and records the lift. The Principal must already exist. */
export async function liftSuspension(principal: PrincipalId, change: FlagChange): Promise<boolean> {
  return applyFlagChange('lift', principal, change)
}

/** Adds the Mice `suspended` flag, ends that Principal's web Sessions, and records the set. */
export async function suspendPrincipal(principal: PrincipalId, change: FlagChange): Promise<boolean> {
  return applyFlagChange('set', principal, change)
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
