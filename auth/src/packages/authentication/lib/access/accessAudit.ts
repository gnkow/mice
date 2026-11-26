import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../../../../db/database.js'
import { principalAccessFlags, sessionRevocations } from '../../../../db/schema.js'
import { principalKey, type PrincipalId } from '../session/principal.js'

/**
 * Credential/suspension state of one Principal for audit deltas: the revocation cut-offs, the
 * permanent-revocation time and whether a `suspension` access flag is active.
 */
export async function principalAccessAuditSnapshot(
  principal: PrincipalId,
  prefix = '',
): Promise<Record<string, unknown>> {
  const key = principalKey(principal)
  const db = getDb()
  const [revocation] = await db
    .select()
    .from(sessionRevocations)
    .where(eq(sessionRevocations.principalKey, key))
  const [flag] = await db
    .select({ id: principalAccessFlags.id })
    .from(principalAccessFlags)
    .where(and(
      eq(principalAccessFlags.principalKey, key),
      eq(principalAccessFlags.flag, 'suspension'),
      isNull(principalAccessFlags.liftedAt),
    ))
    .limit(1)
  return {
    [`${prefix}credentials_not_before`]: revocation?.notBefore ?? null,
    [`${prefix}sessions_not_before`]: revocation?.sessionsNotBefore ?? null,
    [`${prefix}revoked_at`]: revocation?.revokedAt?.toISOString() ?? null,
    [`${prefix}suspended`]: !!flag,
  }
}

/** Snapshot of several Principals, each field prefixed with `iss|sub.`. */
export async function principalsAccessAuditSnapshot(
  principals: readonly PrincipalId[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const principal of principals) {
    Object.assign(out, await principalAccessAuditSnapshot(principal, `${principalKey(principal)}.`))
  }
  return out
}
