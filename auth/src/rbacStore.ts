import { and, asc, eq, gt } from 'drizzle-orm'
import { appendAudit, type AuditActor } from './audit.js'
import { ensurePrincipal } from './authentication/session/session.js'
import { canonicalIssuer } from './authentication/session/principal.js'
import { getDb } from './db/database.js'
import {
  permissionSnapshots,
  principalPermissionHistory,
  principalPermissions,
  principalRoleHistory,
  principalRoles,
  principals,
} from './db/schema.js'
import { isInstancePermission, type InstancePermission } from './rbacCatalog.js'
import { mergeEffectivePermissions } from './rbacEffective.js'
import { isInstanceRole, type InstanceRole } from './rbacRoles.js'
import { ADMIN_MINIMUM_ERROR, decideAdminMinimum } from './adminMinimum.js'

export { ADMIN_MINIMUM_ERROR }

type UserKey = { sub: string; iss: string }
type Result = { ok: true } | { ok: false; error: string }

const INTERNAL_GRANT_EXPIRY = new Date('9999-12-31T00:00:00.000Z')

const BOOTSTRAP_ACTOR: AuditActor = {
  sub: 'rbac-bootstrap',
  iss: 'urn:mice:system',
  email: '',
  name: 'RBAC bootstrap',
}

async function auditActorFor(user: UserKey | null): Promise<{
  actor: AuditActor
  via: 'session' | 'system'
}> {
  if (!user) return { actor: BOOTSTRAP_ACTOR, via: 'system' }
  const iss = canonicalIssuer(user.iss)
  const [row] = await getDb()
    .select({ email: principals.email, name: principals.name })
    .from(principals)
    .where(and(eq(principals.iss, iss), eq(principals.sub, user.sub)))
    .limit(1)
  return {
    actor: {
      sub: user.sub,
      iss,
      email: row?.email ?? '',
      name: row?.name ?? '',
    },
    via: 'session',
  }
}

async function recordRbacAudit(input: {
  actor: UserKey | null
  action: 'role.assign' | 'role.revoke' | 'permission.grant' | 'permission.revoke'
  reason: string
  target: UserKey
  detail: Record<string, unknown>
}): Promise<void> {
  const { actor, via } = await auditActorFor(input.actor)
  await appendAudit({
    actor,
    via,
    method: 'POST',
    path: `/auth/rbac/${input.action}`,
    status: 200,
    action: input.action,
    reason: input.reason,
    detail: {
      target: { sub: input.target.sub, iss: canonicalIssuer(input.target.iss) },
      ...input.detail,
    },
  })
}

export type RoleHistoryEntry = {
  role: InstanceRole
  action: 'granted' | 'revoked' | 'upgraded' | 'downgraded'
  grantedAt: string
  grantReason: string | null
  revokedAt: string | null
  revokeReason: string | null
  accessRequestId: string | null
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
      accessRequestId: r.accessRequestId,
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
  accessRequestId?: string | null
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
    accessRequestId: input.accessRequestId ?? null,
  })
}

/** Principals currently holding the Admin role. */
export async function listAdminPrincipals(now = Date.now()): Promise<Array<{ sub: string; iss: string }>> {
  return getDb()
    .select({ sub: principals.sub, iss: principals.iss })
    .from(principalRoles)
    .innerJoin(principals, eq(principals.id, principalRoles.principalId))
    .where(and(eq(principalRoles.role, 'admin'), gt(principalRoles.expiresAt, new Date(now))))
    .orderBy(asc(principals.iss), asc(principals.sub))
}

/** True when taking Admin away from this principal would break the two-admin floor. */
async function breaksAdminMinimum(
  principalId: number,
  existing: { role: string; expiresAt: Date } | undefined,
): Promise<boolean> {
  if (!existing || existing.role !== 'admin' || existing.expiresAt.getTime() <= Date.now()) return false
  const active = await getDb()
    .select({ id: principalRoles.principalId })
    .from(principalRoles)
    .where(and(eq(principalRoles.role, 'admin'), gt(principalRoles.expiresAt, new Date())))
  return !decideAdminMinimum({
    activeAdminIds: active.map((r) => r.id),
    targetPrincipalId: principalId,
  }).allow
}

export async function assignRole(input: {
  actor: UserKey | null
  target: UserKey
  role: InstanceRole
  reason: string
  expiresAt?: Date | number | null
  bootstrap?: boolean
  accessRequestId?: string | null
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

  if (input.role !== 'admin' && (await breaksAdminMinimum(targetId, existing))) {
    return { ok: false, error: ADMIN_MINIMUM_ERROR }
  }

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
    await recordRbacAudit({
      actor: input.actor,
      action: 'role.revoke',
      reason: input.reason,
      target: input.target,
      detail: { role: existing.role },
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
    accessRequestId: input.accessRequestId,
  })

  await writePermissionSnapshot(input.target, 'role_change')
  await recordRbacAudit({
    actor: input.actor,
    action: 'role.assign',
    reason: input.reason,
    target: input.target,
    detail: {
      role: input.role,
      ...(input.accessRequestId ? { access_request_id: input.accessRequestId } : {}),
    },
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
  if (await breaksAdminMinimum(targetId, existing)) return { ok: false, error: ADMIN_MINIMUM_ERROR }
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
  await writePermissionSnapshot(input.target, 'role_change')
  await recordRbacAudit({
    actor: input.actor,
    action: 'role.revoke',
    reason: input.reason,
    target: input.target,
    detail: { role: existing.role },
  })
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

export type PermissionSnapshot = {
  role: InstanceRole | null
  customPermissions: InstancePermission[]
  effectivePermissions: InstancePermission[]
  snapshotReason: string
  snapshotAt: string
}

async function writePermissionSnapshot(
  target: UserKey,
  reason: string,
): Promise<void> {
  const principalId = await principalIdOf(target)
  if (principalId == null) return
  const role = await getUserRole(target)
  const custom = await getCustomPermissions(target)
  const effective = mergeEffectivePermissions(role, custom)
  await getDb().insert(permissionSnapshots).values({
    principalId,
    snapshotAt: new Date(),
    role,
    customPermissions: custom,
    effectivePermissions: effective,
    snapshotReason: reason,
  })
}

export async function listPermissionSnapshots(user: UserKey): Promise<PermissionSnapshot[]> {
  const id = await principalIdOf(user)
  if (id == null) return []
  const rows = await getDb()
    .select()
    .from(permissionSnapshots)
    .where(eq(permissionSnapshots.principalId, id))
    .orderBy(asc(permissionSnapshots.id))
  return rows.map((r) => ({
    role: r.role && isInstanceRole(r.role) ? r.role : null,
    customPermissions: r.customPermissions.filter(isInstancePermission),
    effectivePermissions: r.effectivePermissions.filter(isInstancePermission),
    snapshotReason: r.snapshotReason,
    snapshotAt: r.snapshotAt.toISOString(),
  }))
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
  accessRequestId?: string | null
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
  await writePermissionSnapshot(input.target, 'permission_grant')
  await recordRbacAudit({
    actor: input.actor,
    action: 'permission.grant',
    reason: input.reason,
    target: input.target,
    detail: {
      permissions: cleaned,
      ...(input.accessRequestId ? { access_request_id: input.accessRequestId } : {}),
    },
  })
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
  await writePermissionSnapshot(input.target, 'permission_revoke')
  await recordRbacAudit({
    actor: input.actor,
    action: 'permission.revoke',
    reason: input.reason,
    target: input.target,
    detail: { permissions: [...input.permissions].filter(isInstancePermission) },
  })
  return { ok: true }
}

export type RbacUserRow = {
  sub: string
  iss: string
  name: string
  email: string
  role: InstanceRole | null
  customPermissionCount: number
}

/** Settings → Users: principals with current role and custom-perm count. */
export async function listRbacUsers(now = Date.now()): Promise<RbacUserRow[]> {
  const people = await getDb()
    .select({
      id: principals.id,
      sub: principals.sub,
      iss: principals.iss,
      name: principals.name,
      email: principals.email,
    })
    .from(principals)
    .orderBy(asc(principals.name), asc(principals.email), asc(principals.sub))

  const roleById = new Map<number, InstanceRole>()
  for (const r of await getDb().select().from(principalRoles)) {
    if (!isInstanceRole(r.role)) continue
    if (r.expiresAt.getTime() <= now) continue
    roleById.set(r.principalId, r.role)
  }

  const countById = new Map<number, number>()
  for (const r of await getDb().select().from(principalPermissions)) {
    if (r.expiresAt.getTime() <= now) continue
    if (!isInstancePermission(r.permission)) continue
    countById.set(r.principalId, (countById.get(r.principalId) ?? 0) + 1)
  }

  return people.map((p) => ({
    sub: p.sub,
    iss: p.iss,
    name: p.name ?? '',
    email: p.email ?? '',
    role: roleById.get(p.id) ?? null,
    customPermissionCount: countById.get(p.id) ?? 0,
  }))
}
