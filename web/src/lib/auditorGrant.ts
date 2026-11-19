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
