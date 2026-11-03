import type { InstancePermission } from './rbacCatalog.js'
import type { InstanceRole } from './rbacRoles.js'

const MANAGER_APPROVABLE: readonly InstanceRole[] = ['external', 'user', 'manager']

/** Whether a reviewer with `reviewerRole` may approve a request for `requestedRole`. */
export function canApproveRole(
  reviewerRole: InstanceRole,
  requestedRole: InstanceRole,
): boolean {
  if (reviewerRole === 'admin') return true
  if (reviewerRole === 'manager') return MANAGER_APPROVABLE.includes(requestedRole)
  return false
}

/** Reviewer must hold every permission they attempt to grant. */
export function canGrantPermissions(
  reviewerEffective: readonly InstancePermission[],
  permissions: readonly string[],
): boolean {
  const have = new Set<string>(reviewerEffective)
  return permissions.every((p) => have.has(p))
}

/**
 * Authority check for the grant that will actually be applied (after optional
 * modify-before-approve). Ignores the originally requested role/perms.
 */
export function canApproveModifiedGrant(input: {
  reviewerRole: InstanceRole
  reviewerEffective: readonly InstancePermission[]
  grantedRole: InstanceRole | null
  grantedPermissions: readonly string[]
}): boolean {
  if (input.grantedRole != null && !canApproveRole(input.reviewerRole, input.grantedRole)) {
    return false
  }
  if (input.grantedPermissions.length > 0) {
    return canGrantPermissions(input.reviewerEffective, input.grantedPermissions)
  }
  return input.grantedRole != null
}
