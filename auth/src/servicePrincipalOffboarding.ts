import { appendAudit, type AuditActor } from './audit.js'
import { suspendOwnedBy } from './servicePrincipals.js'

/** Suspends the service principals owned by an offboarded Principal, audits each with its cause (CI failing is the visible signal). */
export function suspendOwnedWithAudit(
  owner: { iss: string; sub: string },
  cause: 'directory-sync' | 'admin-revocation',
  actor: AuditActor,
): void {
  for (const p of suspendOwnedBy(owner, cause)) {
    appendAudit({
      actor,
      via: 'session',
      method: 'SYNC',
      path: 'service-principals',
      status: 200,
      action: 'service-principal.suspend',
      message: `Suspended service principal ${p.name}: owner offboarded`,
      detail: { id: p.id, name: p.name, cause, owner: { iss: owner.iss, sub: owner.sub } },
    })
  }
}
