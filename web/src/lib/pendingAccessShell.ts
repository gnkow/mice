/** View modes for the no-access /pending shell (RBAC S32). */
export type PendingShellView = 'request' | 'submitted'

/**
 * Pending users must stay on /pending — no profile/notifications/nav escape.
 */
export function shouldRedirectPendingUser(pathname: string, pending: boolean): boolean {
  if (!pending) return false
  return pathname !== '/pending'
}

/** After a successful access request, show the pending confirmation (no form/nav). */
export function pendingShellViewAfterSubmit(_current: PendingShellView): PendingShellView {
  return 'submitted'
}
