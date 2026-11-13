/**
 * Instance Admin floor (Ticket 39, ADR 0007).
 *
 * Removing or demoting an Admin must leave at least two active Admins.
 * Callers load active admin principal ids; this module owns the floor decision.
 */

export const ADMIN_MINIMUM = 2
export const ADMIN_MINIMUM_ERROR = 'At least two admins must remain'

export type AdminMinimumDecision =
  | { allow: true }
  | { allow: false; error: typeof ADMIN_MINIMUM_ERROR }

/** Decide whether taking Admin away from `targetPrincipalId` would break the floor. */
export function decideAdminMinimum(input: {
  activeAdminIds: number[]
  targetPrincipalId: number
}): AdminMinimumDecision {
  const isActiveAdmin = input.activeAdminIds.includes(input.targetPrincipalId)
  if (!isActiveAdmin) return { allow: true }
  if (input.activeAdminIds.length <= ADMIN_MINIMUM) {
    return { allow: false, error: ADMIN_MINIMUM_ERROR }
  }
  return { allow: true }
}
