import { and, eq } from 'drizzle-orm'
import { ensurePrincipal } from './authentication/session/session.js'
import { canonicalIssuer } from './authentication/session/principal.js'
import { getDb } from './db/database.js'
import { principalRoles, principals } from './db/schema.js'
import { isInstanceRole, type InstanceRole } from './rbacRoles.js'

type UserKey = { sub: string; iss: string }
type Result = { ok: true } | { ok: false; error: string }

const INTERNAL_GRANT_EXPIRY = new Date('9999-12-31T00:00:00.000Z')

function toExpiryDate(expiresAt: Date | number): Date {
  return expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
}

async function principalIdOf(user: UserKey): Promise<number | null> {
  const iss = canonicalIssuer(user.iss)
  const [row] = await getDb()
    .select({ id: principals.id })
    .from(principals)
    .where(and(eq(principals.iss, iss), eq(principals.sub, user.sub)))
    .limit(1)
  return row?.id ?? null
}

export async function getUserRole(user: UserKey, now = Date.now()): Promise<InstanceRole | null> {
  const id = await principalIdOf(user)
  if (id == null) return null
  const [row] = await getDb()
    .select()
    .from(principalRoles)
    .where(eq(principalRoles.principalId, id))
    .limit(1)
  if (!row || !isInstanceRole(row.role)) return null
  if (row.expiresAt.getTime() <= now) return null
  return row.role
}

export async function assignRole(input: {
  actor: UserKey | null
  target: UserKey
  role: InstanceRole
  reason: string
  expiresAt?: Date | number | null
  bootstrap?: boolean
}): Promise<Result> {
  if (!isInstanceRole(input.role)) {
    return { ok: false, error: `Invalid role: ${String(input.role)}` }
  }

  let expiresAt: Date
  if (input.bootstrap) {
    expiresAt = INTERNAL_GRANT_EXPIRY
  } else {
    if (input.expiresAt == null) {
      return { ok: false, error: 'expiresAt is required for delegated role grants' }
    }
    const when = typeof input.expiresAt === 'number' ? input.expiresAt : input.expiresAt.getTime()
    if (!Number.isFinite(when) || when <= Date.now()) {
      return { ok: false, error: 'expiresAt must be a future time' }
    }
    expiresAt = toExpiryDate(input.expiresAt)
  }

  const targetId = await ensurePrincipal(input.target)
  const grantedBy = input.actor ? await ensurePrincipal(input.actor) : null
  const grantedAt = new Date()

  await getDb()
    .insert(principalRoles)
    .values({
      principalId: targetId,
      role: input.role,
      grantedAt,
      grantedBy,
      grantReason: input.reason,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: principalRoles.principalId,
      set: {
        role: input.role,
        grantedAt,
        grantedBy,
        grantReason: input.reason,
        expiresAt,
      },
    })

  return { ok: true }
}
