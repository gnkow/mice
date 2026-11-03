import { canApproveModifiedGrant } from './rbacAuthority.js'
import type { InstanceRole } from './rbacRoles.js'
import { assignRole, getEffectivePermissions, getUserRole } from './rbacStore.js'

type UserRef = { sub: string; iss: string }
type Result = { ok: true } | { ok: false; error: string }

export async function directGrantRole(input: {
  actor: UserRef
  target: UserRef
  role: InstanceRole
  reason: string
  expiresAt?: Date | number | null
}): Promise<Result> {
  const actorRole = await getUserRole(input.actor)
  if (!actorRole) return { ok: false, error: 'Forbidden: no actor role' }
  const actorPerms = await getEffectivePermissions(input.actor)

  if (
    !canApproveModifiedGrant({
      reviewerRole: actorRole,
      reviewerEffective: actorPerms,
      grantedRole: input.role,
      grantedPermissions: [],
    })
  ) {
    return { ok: false, error: 'Forbidden: insufficient approval authority' }
  }

  return assignRole({
    actor: input.actor,
    target: input.target,
    role: input.role,
    reason: input.reason,
    expiresAt: input.expiresAt,
  })
}
