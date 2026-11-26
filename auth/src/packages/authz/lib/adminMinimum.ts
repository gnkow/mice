/**
 * Instance Admin floor (Ticket 39, ADR 0007).
 *
 * Removing or demoting an Admin must leave at least two active Admins.
 * Callers load active admin principal ids; this module owns the floor decision
 * and the remaining-count arithmetic after the target is removed.
 */

export const ADMIN_MINIMUM = 2
export const ADMIN_MINIMUM_ERROR = 'At least two admins must remain'

export type AdminMinimumDecision =
  | { allow: true }
  | { allow: false; error: typeof ADMIN_MINIMUM_ERROR }

/** Active Admins that would remain if `targetPrincipalId` lost Admin. */
export function remainingAdminIdsAfterRemoval(
  activeAdminIds: readonly number[],
  targetPrincipalId: number,
): number[] {
  return activeAdminIds.filter((id) => id !== targetPrincipalId)
}

/** Decide whether taking Admin away from `targetPrincipalId` would break the floor. */
export function decideAdminMinimum(input: {
  activeAdminIds: number[]
  targetPrincipalId: number
}): AdminMinimumDecision {
  const isActiveAdmin = input.activeAdminIds.includes(input.targetPrincipalId)
  if (!isActiveAdmin) return { allow: true }
  const remaining = remainingAdminIdsAfterRemoval(
    input.activeAdminIds,
    input.targetPrincipalId,
  )
  if (remaining.length < ADMIN_MINIMUM) {
    return { allow: false, error: ADMIN_MINIMUM_ERROR }
  }
  return { allow: true }
}
