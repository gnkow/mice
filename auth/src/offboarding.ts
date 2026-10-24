import { appendAudit, actorFromUser, type AuditActor, type AuditVia } from './audit.js'
import { isInstanceAdmin } from './authzStore.js'
import { revokeSessionsFor, revokeSessionsOnlyFor } from './credentialRevocation.js'
import { suspendOwnedBy } from './servicePrincipals.js'
import type { SessionUser } from './session.js'

export type OffboardCause = 'admin-revocation' | 'directory-sync' | 'self-service' | 'back-channel-logout'

export type OffboardRequest = {
  /** `sessions` ends Sessions only; `all` also ends PATs. */
  scope: 'sessions' | 'all'
  cause: OffboardCause
  /** Who acted. Required for `admin-revocation` (must be an instance admin); defaults to the Principal. */
  actor?: AuditActor
  via?: AuditVia
  method?: string
  path?: string
  /** Epoch seconds the sessions-only cut-off applies at (back-channel logout uses the token's `iat`). */
  at?: number
  message?: string
  detail?: Record<string, unknown>
}

export type OffboardResult =
  | { ok: true; cutoff: number; suspended: string[] }
  | { ok: false; error: string }

const SYSTEM_ACTOR: AuditActor = { sub: 'directory-sync', iss: 'urn:mice:system', email: '', name: 'Directory sync' }

/** Causes where the Principal leaves the organisation, so service principals they own are suspended. */
const SUSPENDS_OWNED: ReadonlySet<OffboardCause> = new Set(['admin-revocation', 'directory-sync'])

/**
 * Ends a Principal's access: the cut-off for `scope`, the suspension of service principals it
 * owns when it is being offboarded (not merely signing out), and the audit events with their
 * cause. Every path that revokes credentials goes through here.
 */
export function offboard(
  principal: { iss: string; sub: string; email?: string; name?: string },
  req: OffboardRequest,
): OffboardResult {
  const subject = actorFromUser({ email: '', name: '', ...principal } as SessionUser)
  const actor = req.actor ?? subject
  const audit = {
    via: req.via ?? ('session' as AuditVia),
    method: req.method ?? 'SYNC',
    path: req.path ?? req.cause,
  }

  if (req.cause === 'admin-revocation' && !isInstanceAdmin(actor)) {
    appendAudit({
      actor, ...audit, status: 403, action: 'session.revoke',
      message: 'Revoke sessions denied',
      detail: { ...req.detail, source: req.cause },
    })
    return { ok: false, error: 'Forbidden' }
  }

  const cutoff = req.scope === 'all'
    ? revokeSessionsFor(principal)
    : revokeSessionsOnlyFor(principal, req.at)
  appendAudit({
    actor, ...audit, status: 200, action: 'session.revoke',
    message: req.message ?? `Revoked ${req.scope === 'all' ? 'all credentials' : 'Sessions'} of ${principal.sub}`,
    detail: { ...req.detail, source: req.cause },
  })

  const suspended = req.scope === 'all' && SUSPENDS_OWNED.has(req.cause)
    ? suspendOwnedBy(principal, req.cause)
    : []
  for (const p of suspended) {
    appendAudit({
      actor: req.cause === 'admin-revocation' ? actor : SYSTEM_ACTOR,
      ...audit, status: 200, action: 'service-principal.suspend',
      message: `Suspended service principal ${p.name}: owner offboarded`,
      detail: { id: p.id, name: p.name, cause: req.cause, owner: { iss: principal.iss, sub: principal.sub } },
    })
  }
  return { ok: true, cutoff, suspended: suspended.map((p) => p.id) }
}
