/** Operator-visible Auditor grant constraints (Settings → Grant access). */
export const AUDITOR_GRANT_CONSTRAINTS = [
  { id: 'expiry', label: 'Always expires' },
  { id: 'mfa', label: 'MFA every request' },
  { id: 'acl-read', label: 'Read across ACLs' },
  { id: 'no-mutate', label: 'No write, merge, delete, or sign' },
] as const

export const AUDITOR_GRANT_HINT =
  'Auditor grants always expire. The principal must present MFA on every request, can read across ACLs (including signature evidence on Audit), and cannot write, merge, delete, or sign.'

export function isAuditorRole(role: string | null | undefined): boolean {
  return role === 'auditor'
}

/** Banner when /auth/me works but data routes will 403 without MFA. */
export const AUDITOR_MFA_BANNER =
  'Auditor access requires MFA evidence on every request. Complete OTP at the IdP (or re-sign in with MFA), then reload.'

/**
 * Show a shell banner when the signed-in principal is Auditor without MFA evidence.
 * `/auth/me` is exempt so the UI can still identify them.
 */
export function decideAuditorMfaBanner(input: {
  role: string | null | undefined
  mfaEvidenced: boolean | undefined
}): string | null {
  if (!isAuditorRole(input.role)) return null
  if (input.mfaEvidenced === true) return null
  return AUDITOR_MFA_BANNER
}
