import { appendAudit, appendIntent, appendOutcome, actorFromUser, type AuditActor, type AuditVia } from '../../audit.js'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import { revokeAllCliCredentials } from './cliCredentials.js'
import { revokeSessionsFor, revokeSessionsOnlyFor } from './credentialRevocation.js'
import type { SessionUser } from '../session/session.js'

export type OffboardCause = 'admin-revocation' | 'directory-sync' | 'self-service' | 'back-channel-logout'

export type OffboardRequest = {
  /** `sessions` ends Sessions only; `all` also ends CLI credentials. */
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
  /** Write the audit Intent before revoking; when it cannot be stored, nothing is revoked. */
  strictAudit?: boolean
}

export type OffboardStep = 'revoke-credentials' | 'audit-revocation'

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

/**
 * Ends a Principal's Sessions and, when `scope` is `all`, their other credentials.
 * Every path that revokes credentials goes through here.
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

  const auditEvent = {
    actor, ...audit, status: 200, action: 'session.revoke',
    message: req.message ?? `Revoked ${req.scope === 'all' ? 'all credentials' : 'Sessions'} of ${principal.sub}`,
    detail: { ...req.detail, source: req.cause },
  }

  let strictIntent: Awaited<ReturnType<typeof appendIntent>> | undefined
  if (req.strictAudit) {
    try {
      strictIntent = await appendIntent({ ...auditEvent, status: 0, reason: req.message })
    } catch {
      failed.push({ step: 'audit-revocation', error: 'audit Intent could not be stored' })
      return {
        ok: false,
        error: 'Offboarding incomplete',
        cutoff: null,
        suspended: [],
        completed,
        failed,
      }
    }
  }

  const cutoff = await attempt('revoke-credentials', async () => {
    if (req.scope !== 'all') return revokeSessionsOnlyFor(principal, req.at)
    const cutoff = await revokeSessionsFor(principal)
    await revokeAllCliCredentials(principal)
    return cutoff
  })
  if (cutoff === undefined) failed.push({ step: 'audit-revocation', error: 'skipped: revoke-credentials failed' })
  else if (strictIntent) {
    await attempt('audit-revocation', () => appendOutcome(strictIntent!.id, auditEvent))
  } else await attempt('audit-revocation', async () => await appendAudit(auditEvent))

  const suspended: string[] = []
  if (failed.length) {
    return { ok: false, error: 'Offboarding incomplete', cutoff: cutoff ?? null, suspended, completed, failed }
  }
  return { ok: true, cutoff: cutoff!, suspended, completed, failed: [] }
}
