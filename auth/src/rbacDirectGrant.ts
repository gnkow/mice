import { canApproveModifiedGrant } from './rbacAuthority.js'
import type { InstanceRole } from './rbacRoles.js'
import {
  assignRole,
  getEffectivePermissions,
  getUserRole,
  grantCustomPermissions,
} from './rbacStore.js'

type UserRef = { sub: string; iss: string }
type Result = { ok: true } | { ok: false; error: string }

/**
 * Deep Authorized Grant seam: load actor authority, validate the grant bundle,
 * then apply role and/or custom permissions. Shared by direct grant and approve.
 */
export async function applyAuthorizedGrant(input: {
  actor: UserRef
  target: UserRef
  role?: InstanceRole | null
  permissions?: readonly string[]
  reason: string
  expiresAt?: Date | number | null
  accessRequestId?: string | null
}): Promise<Result> {
  const role = input.role ?? null
  const permissions = [...(input.permissions ?? [])]

  if (role == null && permissions.length === 0) {
    return { ok: false, error: 'Grant must include a role or custom permissions' }
  }

  const actorRole = await getUserRole(input.actor)
  if (!actorRole) return { ok: false, error: 'Forbidden: no actor role' }
  const actorPerms = await getEffectivePermissions(input.actor)

  if (
    !canApproveModifiedGrant({
      reviewerRole: actorRole,
      reviewerEffective: actorPerms,
      grantedRole: role,
      grantedPermissions: permissions,
    })
  ) {
    return { ok: false, error: 'Forbidden: insufficient approval authority' }
  }

  if (role) {
    const roleResult = await assignRole({
      actor: input.actor,
      target: input.target,
      role,
      reason: input.reason,
      expiresAt: input.expiresAt,
      accessRequestId: input.accessRequestId,
    })
    if (!roleResult.ok) return roleResult
  }

  if (permissions.length > 0) {
    const permResult = await grantCustomPermissions({
      actor: input.actor,
      target: input.target,
      permissions,
      reason: input.reason,
      expiresAt: input.expiresAt,
      accessRequestId: input.accessRequestId,
    })
    if (!permResult.ok) return permResult
  }

  return { ok: true }
}

export async function directGrantRole(input: {
  actor: UserRef
  target: UserRef
  role: InstanceRole
  reason: string
  expiresAt?: Date | number | null
}): Promise<Result> {
  return applyAuthorizedGrant({
    actor: input.actor,
    target: input.target,
    role: input.role,
    permissions: [],
    reason: input.reason,
    expiresAt: input.expiresAt,
  })
}

export async function directGrantPermissions(input: {
  actor: UserRef
  target: UserRef
  permissions: readonly string[]
  reason: string
  expiresAt?: Date | number | null
}): Promise<Result> {
  return applyAuthorizedGrant({
    actor: input.actor,
    target: input.target,
    role: null,
    permissions: input.permissions,
    reason: input.reason,
    expiresAt: input.expiresAt,
  })
}
