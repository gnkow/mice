import { env } from './env.js'
import { getServicePrincipal } from './servicePrincipals.js'
import { currentClock } from './clock.js'
import { kindOf, principalKey } from './principal.js'

/** Carries an explicit reason on any mutating request (JSON, multipart, binary or bodiless). */
export const REASON_HEADER = 'x-mice-reason'

const MAX_REASON_LENGTH = 1000

/** `registered` is the fixed reason of a service principal. */
export type ReasonSource = 'explicit' | 'commit-message' | 'registered'

export type ResolvedReason = { reason: string; reason_source: ReasonSource }

export type ReasonRejection = {
  code: 'reason_required' | 'reason_too_short'
  detail: string
}

/**
 * Proxied actions that change what a dataset shows. Staging, object uploads and derived-data
 * operations are not in the list: they become visible only through one of these.
 */
const DATASET_MUTATIONS = new Set([
  'file.write',
  'file.delete',
  'commit.publish',
  'merge',
  'branch.create',
  'branch.update',
  'branch.delete',
  'repo.create',
  'repo.delete',
  'repo.metadata',
  'namespace.create',
  'workspace.commit',
  'workspace.merge',
])

export function isDatasetMutation(action: string): boolean {
  return DATASET_MUTATIONS.has(action)
}

const DEFAULT_DECLARED_TTL_SEC = 300
const MAX_DECLARED_TTL_SEC = 3600
/** In memory by design: a declaration is short-lived and a restart only means declaring again. */
const declared = new Map<string, { reason: string; expiresAt: number }>()

/**
 * For clients that cannot send a header (the oxen binary): the caller states a reason once and it
 * applies to its next mutations for a short time. It counts as an explicit reason.
 */
export function declareReason(
  actor: { sub: string; iss: string },
  raw: unknown,
  ttlSec?: number,
): { ok: true; expiresAt: string } | { ok: false; error: string } {
  const reason = typeof raw === 'string' ? raw.trim() : ''
  if (reason.length < env.auditReasonMinLength || reason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `reason must be ${env.auditReasonMinLength}-${MAX_REASON_LENGTH} characters` }
  }
  const ttl = Math.min(Math.max(1, Number.isFinite(ttlSec) ? (ttlSec as number) : DEFAULT_DECLARED_TTL_SEC), MAX_DECLARED_TTL_SEC)
  const expiresAt = currentClock.now() + ttl * 1000
  declared.set(principalKey(actor), { reason, expiresAt })
  return { ok: true, expiresAt: new Date(expiresAt).toISOString() }
}

function declaredReason(actor: { sub: string; iss: string }): string | undefined {
  const d = declared.get(principalKey(actor))
  if (!d) return undefined
  if (d.expiresAt <= currentClock.now()) {
    declared.delete(principalKey(actor))
    return undefined
  }
  return d.reason
}

const clean = (v: string | null | undefined): string => (v ?? '').trim().slice(0, MAX_REASON_LENGTH)

/**
 * Picks the reason for a mutation: an explicit one wins; a service principal falls back to its
 * registered reason; others fall back to the commit message. A chosen reason shorter than the
 * single minimum-length setting is rejected, never silently replaced by a fallback.
 */
export function resolveReason(input: {
  actor: { sub: string; iss: string }
  explicit?: string | null
  message?: string
}): { ok: true; value: ResolvedReason } | { ok: false; rejection: ReasonRejection } {
  const min = env.auditReasonMinLength
  const explicit = clean(input.explicit) || clean(declaredReason(input.actor))
  let picked: ResolvedReason | undefined
  if (explicit) picked = { reason: explicit, reason_source: 'explicit' }
  else if (kindOf(input.actor) === 'service') {
    const registered = clean(getServicePrincipal(input.actor.sub)?.reason)
    if (registered) picked = { reason: registered, reason_source: 'registered' }
  } else {
    const message = clean(input.message)
    if (message) picked = { reason: message, reason_source: 'commit-message' }
  }
  if (!picked) {
    return {
      ok: false,
      rejection: {
        code: 'reason_required',
        detail: `A reason of at least ${min} characters is required: send it in the X-Mice-Reason header or use a commit message that long`,
      },
    }
  }
  if (picked.reason.length < min) {
    return {
      ok: false,
      rejection: {
        code: 'reason_too_short',
        detail: `The ${picked.reason_source === 'commit-message' ? 'commit message' : 'reason'} is ${picked.reason.length} characters; at least ${min} are required. Lengthen it or send a longer reason in the X-Mice-Reason header`,
      },
    }
  }
  return { ok: true, value: picked }
}
