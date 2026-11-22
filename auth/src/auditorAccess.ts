import type { RepoRole } from './authzTypes.js'

/** Refusal when an Auditor-role principal lacks IdP MFA evidence. */
export const AUDITOR_MFA_REASON = 'Auditor access requires MFA evidence'

/** Refusal when an Auditor tries to enter a signing ceremony. */
export const AUDITOR_CANNOT_SIGN = 'Auditor role cannot sign'

/**
 * Pure MFA gate for the Auditor formal role.
 * Callers supply the resolved role and whether the session evidences MFA.
 */
export function decideAuditorMfa(input: {
  role: string | null
  hasMfa: boolean
}): string | null {
  return input.role === 'auditor' && !input.hasMfa ? AUDITOR_MFA_REASON : null
}

/**
 * Admission after bootstrap: apply the MFA gate unless the route opts out
 * (`/auth/me` and `/auth/me/authz` so the UI can identify an Auditor who still needs OTP).
 */
export function decideAuditorAdmission(input: {
  role: string | null
  hasMfa: boolean
  allowWithoutMfa?: boolean
}): string | null {
  if (input.allowWithoutMfa) return null
  return decideAuditorMfa({ role: input.role, hasMfa: input.hasMfa })
}

/**
 * Pure ACL-bypass read decision (Auditor / custom `repo:bypass_acl`).
 * Never for PATs; MFA required; only when the need is `read`.
 */
export function decideAclBypassRead(input: {
  need: RepoRole
  isPat: boolean
  hasBypassAcl: boolean
  hasMfa: boolean
}): { allow: boolean; bypass: boolean } {
  if (input.need !== 'read' || input.isPat || !input.hasBypassAcl || !input.hasMfa) {
    return { allow: false, bypass: false }
  }
  return { allow: true, bypass: true }
}

/** Pure: Auditors cannot sign (write/merge/delete ceremony). */
export function decideAuditorCannotSign(role: string | null): string | null {
  return role === 'auditor' ? AUDITOR_CANNOT_SIGN : null
}
