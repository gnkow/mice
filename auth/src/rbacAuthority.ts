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
