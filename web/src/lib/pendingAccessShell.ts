/** View modes for the no-access /pending shell (RBAC S32). */
export type PendingShellView = 'request' | 'submitted'

/**
 * Pending users must stay on /pending — no profile/notifications/nav escape.
 */
export function shouldRedirectPendingUser(pathname: string, pending: boolean): boolean {
  if (!pending) return false
  return pathname !== '/pending'
}

/** Load /pending with an existing request already in the submitted confirmation. */
export function initialPendingShellView(hasPendingRequest: boolean): PendingShellView {
  return hasPendingRequest ? 'submitted' : 'request'
}

/** After a successful access request, show the pending confirmation (no form/nav). */
export function pendingShellViewAfterSubmit(_current: PendingShellView): PendingShellView {
  return 'submitted'
}

/** Summary line for the success card (role label or permission count). */
export function pendingRequestAccessSummary(input: {
  requestedRole?: string | null
  requestedPermissions?: readonly string[] | null
  roleLabel?: string | null
}): string {
  if (input.requestedRole) {
    return input.roleLabel ?? input.requestedRole
  }
  const n = input.requestedPermissions?.length ?? 0
  return `${n} permission${n === 1 ? '' : 's'}`
}
