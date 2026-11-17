import { eq, sql } from 'drizzle-orm'
import { currentClock } from '../../clock.js'
import { getDb, type Tx } from '../../db/database.js'
import { sessionRevocations } from '../../db/schema.js'
import { principalKey } from '../session/principal.js'

type CredentialKind = 'session' | 'pat'

/** DB handle that can bump cutoffs (root pool or an open transaction). */
export type CredentialCutoffStore = Pick<Tx, 'insert' | 'select'>

const nowSec = () => Math.floor(currentClock.now() / 1000)

/**
 * Bump the all-credentials cutoff (`notBefore`). Sessions and PATs issued at or
 * before `at` fail the live check. Never lowers an existing cutoff.
 */
export async function bumpAllCredentialsCutoff(
  store: CredentialCutoffStore,
  principal: { iss: string; sub: string },
  at: number,
): Promise<number> {
  const [row] = await store
    .insert(sessionRevocations)
    .values({ principalKey: principalKey(principal), notBefore: at })
    .onConflictDoUpdate({
      target: sessionRevocations.principalKey,
      set: { notBefore: sql`greatest(coalesce(${sessionRevocations.notBefore}, 0), ${at})` },
    })
    .returning({ notBefore: sessionRevocations.notBefore })
  return row!.notBefore!
}

/**
 * Bump the Sessions-only cutoff (`sessionsNotBefore`). PATs stay valid. Never
 * lowers an existing Sessions-only cutoff.
 */
export async function bumpSessionsOnlyCutoff(
  store: CredentialCutoffStore,
  principal: { iss: string; sub: string },
  at: number,
): Promise<number> {
  const [row] = await store
    .insert(sessionRevocations)
    .values({ principalKey: principalKey(principal), sessionsNotBefore: at })
    .onConflictDoUpdate({
      target: sessionRevocations.principalKey,
      set: {
        sessionsNotBefore: sql`greatest(coalesce(${sessionRevocations.sessionsNotBefore}, 0), ${at})`,
      },
    })
    .returning({ sessionsNotBefore: sessionRevocations.sessionsNotBefore })
  return row!.sessionsNotBefore!
}

/**
 * Permanent revocation: bump all-credentials cutoff and set `revokedAt` once
 * (blocks a fresh login via `isPrincipalAccessRevoked`).
 */
export async function markPermanentlyRevoked(
  store: CredentialCutoffStore,
  principal: { iss: string; sub: string },
  at: number,
): Promise<void> {
  const key = principalKey(principal)
  const revokedAt = new Date(at * 1000)
  await store
    .insert(sessionRevocations)
    .values({ principalKey: key, notBefore: at, revokedAt })
    .onConflictDoUpdate({
      target: sessionRevocations.principalKey,
      set: {
        notBefore: sql`greatest(coalesce(${sessionRevocations.notBefore}, 0), ${at})`,
        revokedAt: sql`coalesce(${sessionRevocations.revokedAt}, ${revokedAt})`,
      },
    })
}

/** Invalidate every Session and PAT of a Principal issued up to now. Returns the cut-off (epoch s). */
export async function revokeSessionsFor(principal: { iss: string; sub: string }): Promise<number> {
  return bumpAllCredentialsCutoff(getDb(), principal, nowSec())
}

/** Invalidate Sessions only; PATs stay valid. Returns the cut-off (epoch s). */
export async function revokeSessionsOnlyFor(
  principal: { iss: string; sub: string },
  at: number = nowSec(),
): Promise<number> {
  return bumpSessionsOnlyCutoff(getDb(), principal, at)
}

/** True when `revokedAt` is set (permanent admin revoke). */
export async function isPermanentlyRevoked(principal: {
  iss: string
  sub: string
}): Promise<boolean> {
  const [row] = await getDb()
    .select({ revokedAt: sessionRevocations.revokedAt })
    .from(sessionRevocations)
    .where(eq(sessionRevocations.principalKey, principalKey(principal)))
  return !!row?.revokedAt
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
  if (row.revokedAt) return true
  const sessionsOnly = kind === 'session' ? row.sessionsNotBefore : null
  const cutoff = Math.max(row.notBefore ?? -1, sessionsOnly ?? -1)
  return cutoff >= 0 && issuedAt <= cutoff
}
