import { and, asc, eq } from 'drizzle-orm'
import { ensurePrincipal } from './authentication/session/session.js'
import { canonicalIssuer } from './authentication/session/principal.js'
import { getDb } from './db/database.js'
import {
  principalPermissionHistory,
  principalPermissions,
  principalRoleHistory,
  principalRoles,
  principals,
} from './db/schema.js'
import { isInstancePermission, type InstancePermission } from './rbacCatalog.js'
import { mergeEffectivePermissions } from './rbacEffective.js'
import { isInstanceRole, type InstanceRole } from './rbacRoles.js'

type UserKey = { sub: string; iss: string }
type Result = { ok: true } | { ok: false; error: string }

const INTERNAL_GRANT_EXPIRY = new Date('9999-12-31T00:00:00.000Z')

export type RoleHistoryEntry = {
  role: InstanceRole
  action: 'granted' | 'revoked' | 'upgraded' | 'downgraded'
  grantedAt: string
  grantReason: string | null
  revokedAt: string | null
  revokeReason: string | null
}

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

export async function listRoleHistory(user: UserKey): Promise<RoleHistoryEntry[]> {
  const id = await principalIdOf(user)
  if (id == null) return []
  const rows = await getDb()
    .select()
    .from(principalRoleHistory)
    .where(eq(principalRoleHistory.principalId, id))
    .orderBy(asc(principalRoleHistory.id))
  return rows.flatMap((r) => {
    if (!isInstanceRole(r.role)) return []
    if (r.action !== 'granted' && r.action !== 'revoked' && r.action !== 'upgraded' && r.action !== 'downgraded') {
      return []
    }
    return [{
      role: r.role,
      action: r.action,
      grantedAt: r.grantedAt.toISOString(),
      grantReason: r.grantReason,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokeReason: r.revokeReason,
    }]
  })
}

async function appendRoleHistory(input: {
  principalId: number
  role: InstanceRole
  action: RoleHistoryEntry['action']
  grantedAt: Date
  grantedBy: number | null
  grantReason: string | null
  revokedAt?: Date | null
  revokedBy?: number | null
  revokeReason?: string | null
}): Promise<void> {
  await getDb().insert(principalRoleHistory).values({
    principalId: input.principalId,
    role: input.role,
    action: input.action,
    grantedAt: input.grantedAt,
    grantedBy: input.grantedBy,
    grantReason: input.grantReason,
    revokedAt: input.revokedAt ?? null,
    revokedBy: input.revokedBy ?? null,
    revokeReason: input.revokeReason ?? null,
  })
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

  const [existing] = await getDb()
    .select()
    .from(principalRoles)
    .where(eq(principalRoles.principalId, targetId))
    .limit(1)

  if (existing && isInstanceRole(existing.role)) {
    await appendRoleHistory({
      principalId: targetId,
      role: existing.role,
      action: 'revoked',
      grantedAt: existing.grantedAt,
      grantedBy: existing.grantedBy,
      grantReason: existing.grantReason,
      revokedAt: grantedAt,
      revokedBy: grantedBy,
      revokeReason: input.reason,
    })
  }

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

  await appendRoleHistory({
    principalId: targetId,
    role: input.role,
    action: 'granted',
    grantedAt,
    grantedBy,
    grantReason: input.reason,
  })

  return { ok: true }
}

export async function revokeRole(input: {
  actor: UserKey
  target: UserKey
  reason: string
}): Promise<Result> {
  const targetId = await principalIdOf(input.target)
  if (targetId == null) return { ok: false, error: 'Not found' }
  const [existing] = await getDb()
    .select()
    .from(principalRoles)
    .where(eq(principalRoles.principalId, targetId))
    .limit(1)
  if (!existing || !isInstanceRole(existing.role)) {
    return { ok: false, error: 'No active role' }
  }
  const revokedBy = await ensurePrincipal(input.actor)
  const revokedAt = new Date()
  await appendRoleHistory({
    principalId: targetId,
    role: existing.role,
    action: 'revoked',
    grantedAt: existing.grantedAt,
    grantedBy: existing.grantedBy,
    grantReason: existing.grantReason,
    revokedAt,
    revokedBy,
    revokeReason: input.reason,
  })
  await getDb().delete(principalRoles).where(eq(principalRoles.principalId, targetId))
  return { ok: true }
}

export type PermissionHistoryEntry = {
  permission: InstancePermission
  action: 'granted' | 'revoked'
  grantedAt: string
  grantReason: string | null
  revokedAt: string | null
  revokeReason: string | null
}

export async function getCustomPermissions(
  user: UserKey,
  now = Date.now(),
): Promise<InstancePermission[]> {
  const id = await principalIdOf(user)
  if (id == null) return []
  const rows = await getDb()
    .select()
    .from(principalPermissions)
    .where(eq(principalPermissions.principalId, id))
  const out: InstancePermission[] = []
  for (const r of rows) {
    if (r.expiresAt.getTime() <= now) continue
    if (!isInstancePermission(r.permission)) continue
    out.push(r.permission)
  }
  return out
}

export async function listPermissionHistory(user: UserKey): Promise<PermissionHistoryEntry[]> {
  const id = await principalIdOf(user)
  if (id == null) return []
  const rows = await getDb()
    .select()
    .from(principalPermissionHistory)
    .where(eq(principalPermissionHistory.principalId, id))
    .orderBy(asc(principalPermissionHistory.id))
  return rows.flatMap((r) => {
    if (!isInstancePermission(r.permission)) return []
    if (r.action !== 'granted' && r.action !== 'revoked') return []
    return [{
      permission: r.permission,
      action: r.action,
      grantedAt: r.grantedAt.toISOString(),
      grantReason: r.grantReason,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokeReason: r.revokeReason,
    }]
  })
}

async function appendPermissionHistory(input: {
  principalId: number
  permission: InstancePermission
  action: 'granted' | 'revoked'
  grantedAt: Date
  grantedBy: number | null
  grantReason: string | null
  revokedAt?: Date | null
  revokedBy?: number | null
  revokeReason?: string | null
}): Promise<void> {
  await getDb().insert(principalPermissionHistory).values({
    principalId: input.principalId,
    permission: input.permission,
    action: input.action,
    grantedAt: input.grantedAt,
    grantedBy: input.grantedBy,
    grantReason: input.grantReason,
    revokedAt: input.revokedAt ?? null,
    revokedBy: input.revokedBy ?? null,
    revokeReason: input.revokeReason ?? null,
  })
}

export async function grantCustomPermissions(input: {
  actor: UserKey | null
  target: UserKey
  permissions: readonly string[]
  reason: string
  expiresAt?: Date | number | null
  bootstrap?: boolean
}): Promise<Result> {
  const cleaned: InstancePermission[] = []
  for (const p of input.permissions) {
    if (!isInstancePermission(p)) {
      return { ok: false, error: `Invalid permission: ${p}` }
    }
    if (!cleaned.includes(p)) cleaned.push(p)
  }
  if (cleaned.length === 0) return { ok: true }

  let expiresAt: Date
  if (input.bootstrap) {
    expiresAt = INTERNAL_GRANT_EXPIRY
  } else {
    if (input.expiresAt == null) {
      return { ok: false, error: 'expiresAt is required for delegated permission grants' }
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

  for (const permission of cleaned) {
    await getDb()
      .insert(principalPermissions)
      .values({
        principalId: targetId,
        permission,
        grantedAt,
        grantedBy,
        grantReason: input.reason,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [principalPermissions.principalId, principalPermissions.permission],
        set: {
          grantedAt,
          grantedBy,
          grantReason: input.reason,
          expiresAt,
        },
      })
    await appendPermissionHistory({
      principalId: targetId,
      permission,
      action: 'granted',
      grantedAt,
      grantedBy,
      grantReason: input.reason,
    })
  }
  return { ok: true }
}

export async function getEffectivePermissions(
  user: UserKey,
  now = Date.now(),
): Promise<InstancePermission[]> {
  const role = await getUserRole(user, now)
  const custom = await getCustomPermissions(user, now)
  return mergeEffectivePermissions(role, custom)
}

export async function hasPermission(
  user: UserKey,
  permission: InstancePermission,
  now = Date.now(),
): Promise<boolean> {
  return (await getEffectivePermissions(user, now)).includes(permission)
}

export async function revokeCustomPermissions(input: {
  actor: UserKey
  target: UserKey
  permissions: readonly string[]
  reason: string
}): Promise<Result> {
  const targetId = await principalIdOf(input.target)
  if (targetId == null) return { ok: false, error: 'Not found' }
  const revokedBy = await ensurePrincipal(input.actor)
  const revokedAt = new Date()

  for (const permission of input.permissions) {
    if (!isInstancePermission(permission)) {
      return { ok: false, error: `Invalid permission: ${permission}` }
    }
    const [existing] = await getDb()
      .select()
      .from(principalPermissions)
      .where(
        and(
          eq(principalPermissions.principalId, targetId),
          eq(principalPermissions.permission, permission),
        ),
      )
      .limit(1)
    if (!existing) continue
    await appendPermissionHistory({
      principalId: targetId,
      permission,
      action: 'revoked',
      grantedAt: existing.grantedAt,
      grantedBy: existing.grantedBy,
      grantReason: existing.grantReason,
      revokedAt,
      revokedBy,
      revokeReason: input.reason,
    })
    await getDb()
      .delete(principalPermissions)
      .where(
        and(
          eq(principalPermissions.principalId, targetId),
          eq(principalPermissions.permission, permission),
        ),
      )
  }
  return { ok: true }
}
