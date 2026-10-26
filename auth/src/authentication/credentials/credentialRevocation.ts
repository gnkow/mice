import { eq, sql } from 'drizzle-orm'
import { currentClock } from '../../clock.js'
import { getDb } from '../../db/database.js'
import { sessionRevocations } from '../../db/schema.js'
import { principalKey } from '../session/principal.js'

type CredentialKind = 'session' | 'pat'

const nowSec = () => Math.floor(currentClock.now() / 1000)

/** Invalidate every Session and PAT of a Principal issued up to now. Returns the cut-off (epoch s). */
export async function revokeSessionsFor(principal: { iss: string; sub: string }): Promise<number> {
  const cutoff = nowSec()
  const [row] = await getDb()
    .insert(sessionRevocations)
    .values({ principalKey: principalKey(principal), notBefore: cutoff })
    .onConflictDoUpdate({
      target: sessionRevocations.principalKey,
      set: { notBefore: sql`greatest(coalesce(${sessionRevocations.notBefore}, 0), ${cutoff})` },
    })
    .returning({ notBefore: sessionRevocations.notBefore })
  return row!.notBefore!
}

/** Invalidate Sessions only; PATs stay valid. Returns the cut-off (epoch s). */
export async function revokeSessionsOnlyFor(
  principal: { iss: string; sub: string },
  at: number = nowSec(),
): Promise<number> {
  const [row] = await getDb()
    .insert(sessionRevocations)
    .values({ principalKey: principalKey(principal), sessionsNotBefore: at })
    .onConflictDoUpdate({
      target: sessionRevocations.principalKey,
      set: { sessionsNotBefore: sql`greatest(coalesce(${sessionRevocations.sessionsNotBefore}, 0), ${at})` },
    })
    .returning({ sessionsNotBefore: sessionRevocations.sessionsNotBefore })
  return row!.sessionsNotBefore!
}

/**
 * True when a credential of `kind` (Session cookie or PAT) first issued at `issuedAt` (epoch s)
 * predates the Principal's revocation cut-off. Every credential type must pass this check.
 */
export async function isCredentialRevoked(
  principal: { iss: string; sub: string },
  issuedAt: number,
  kind: CredentialKind,
): Promise<boolean> {
  const [row] = await getDb()
    .select()
    .from(sessionRevocations)
    .where(eq(sessionRevocations.principalKey, principalKey(principal)))
  if (!row) return false
  const sessionsOnly = kind === 'session' ? row.sessionsNotBefore : null
  const cutoff = Math.max(row.notBefore ?? -1, sessionsOnly ?? -1)
  return cutoff >= 0 && issuedAt <= cutoff
}
