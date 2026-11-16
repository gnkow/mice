import { AuthzError } from './authzApi'

/** Audit actions that carry a signature id the UI can revoke or mark as revoked. */
export const SIGNATURE_CREATED_ACTIONS = new Set(['esign.created', 'signature.created'])
export const SIGNATURE_REVOKED_ACTION = 'esign.revoked'

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** Signature id on an `esign.created` audit event, when it can be revoked. */
export function revocableSignatureId(action: string, detail: Record<string, unknown> | undefined): string | undefined {
  if (!SIGNATURE_CREATED_ACTIONS.has(action)) return undefined
  return str(detail?.signatureId)
}

/** Signature ids already revoked according to the loaded audit events. */
export function revokedSignatureIds(
  events: Array<{ action: string; detail?: Record<string, unknown> }>,
): Set<string> {
  const ids = new Set<string>()
  for (const ev of events) {
    if (ev.action !== SIGNATURE_REVOKED_ACTION) continue
    const id = str(ev.detail?.signatureId)
    if (id) ids.add(id)
  }
  return ids
}

/** Operator-facing message for a failed revoke; `not_approver` explains how to get the role. */
export function revokeFailureMessage(err: unknown): string {
  if (err instanceof AuthzError) {
    switch (err.code) {
      case 'not_approver':
        return 'You are not an approver for this repository, so you cannot revoke this signature. Ask a namespace Owner to assign you the approver role in the repository or namespace settings.'
      case 'not_found':
        return 'Signature not found.'
      case 'no_binding':
        return 'This signature is not bound to a repository, so it cannot be revoked here.'
      default:
        break
    }
    if (err.status === 403) return `Not allowed: ${err.message}`
    return err.message
  }
  return err instanceof Error ? err.message : 'Revoke failed'
}
