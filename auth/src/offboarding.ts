import { appendAudit, actorFromUser, type AuditActor, type AuditVia } from './audit.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
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

export type OffboardStep = 'revoke-credentials' | 'audit-revocation' | 'suspend-service-principals' | 'audit-suspensions'

/**
 * `ok: true` means every step ran. A step that throws does not stop the others: the result lists
 * `completed` and `failed` steps so a partial offboarding is visible and retryable (every step is idempotent).
 * A step whose prerequisite failed is reported failed without running.
 */
export type OffboardResult =
  | { ok: true; cutoff: number; suspended: string[]; completed: OffboardStep[]; failed: [] }
  | { ok: false; error: 'Forbidden' }
  | {
      ok: false
      error: 'Offboarding incomplete'
      cutoff: number | null
      suspended: string[]
      completed: OffboardStep[]
      failed: Array<{ step: OffboardStep; error: string }>
    }

const SYSTEM_ACTOR: AuditActor = { sub: 'directory-sync', iss: 'urn:mice:system', email: '', name: 'Directory sync' }

/** Causes where the Principal leaves the organisation, so service principals they own are suspended. */
const SUSPENDS_OWNED: ReadonlySet<OffboardCause> = new Set(['admin-revocation', 'directory-sync'])

/**
 * Ends a Principal's access: the cut-off for `scope`, the suspension of service principals it
 * owns when it is being offboarded (not merely signing out), and the audit events with their
 * cause. Every path that revokes credentials goes through here.
 */
export async function offboard(
  principal: { iss: string; sub: string; email?: string; name?: string },
  req: OffboardRequest,
): Promise<OffboardResult> {
  const subject = actorFromUser({ email: '', name: '', ...principal } as SessionUser)
  const actor = req.actor ?? subject
  const audit = {
    via: req.via ?? ('session' as AuditVia),
    method: req.method ?? 'SYNC',
    path: req.path ?? req.cause,
  }

  if (req.cause === 'admin-revocation' && !await isInstanceAdmin(actor)) {
    await appendAudit({
      actor, ...audit, status: 403, action: 'session.revoke',
      message: 'Revoke sessions denied',
      detail: { ...req.detail, source: req.cause },
    })
    return { ok: false, error: 'Forbidden' }
  }

  const completed: OffboardStep[] = []
  const failed: Array<{ step: OffboardStep; error: string }> = []
  const attempt = async <T>(step: OffboardStep, fn: () => T | null | Promise<T | null>): Promise<T | undefined> => {
    try {
      const out = await fn()
      if (out === null) throw new Error('audit append failed')
      completed.push(step)
      return out
    } catch (error) {
      failed.push({ step, error: error instanceof Error ? error.message : String(error) })
      return undefined
    }
  }

  const cutoff = await attempt('revoke-credentials', () => req.scope === 'all'
    ? revokeSessionsFor(principal)
    : revokeSessionsOnlyFor(principal, req.at))
  if (cutoff === undefined) failed.push({ step: 'audit-revocation', error: 'skipped: revoke-credentials failed' })
  else await attempt('audit-revocation', async () => await appendAudit({
    actor, ...audit, status: 200, action: 'session.revoke',
    message: req.message ?? `Revoked ${req.scope === 'all' ? 'all credentials' : 'Sessions'} of ${principal.sub}`,
    detail: { ...req.detail, source: req.cause },
  }))

  const suspendedPrincipals = req.scope === 'all' && SUSPENDS_OWNED.has(req.cause)
    ? (await attempt('suspend-service-principals', () => suspendOwnedBy(principal, req.cause))) ?? []
    : []
  if (suspendedPrincipals.length) {
    await attempt('audit-suspensions', async () => {
      for (const p of suspendedPrincipals) {
        const event = await appendAudit({
          actor: req.cause === 'admin-revocation' ? actor : SYSTEM_ACTOR,
          ...audit, status: 200, action: 'service-principal.suspend',
          message: `Suspended service principal ${p.name}: owner offboarded`,
          detail: { id: p.id, name: p.name, cause: req.cause, owner: { iss: principal.iss, sub: principal.sub } },
        })
        if (!event) throw new Error(`audit append failed for ${p.id}`)
      }
      return true
    })
  }

  const suspended = suspendedPrincipals.map((p) => p.id)
  if (failed.length) {
    return { ok: false, error: 'Offboarding incomplete', cutoff: cutoff ?? null, suspended, completed, failed }
  }
  return { ok: true, cutoff: cutoff!, suspended, completed, failed: [] }
}
