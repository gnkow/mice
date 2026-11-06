import { env } from './env.js'
import { principalKey } from './authentication/index.js'
import { currentClock } from './clock.js'

/** Carries an explicit reason on any mutating request (JSON, multipart, binary or bodiless). */
export const REASON_HEADER = 'x-mice-reason'

/** Pick-list category for a required reason (GxP ticket 03). */
export const REASON_CATEGORY_HEADER = 'x-mice-reason-category'

const MAX_REASON_LENGTH = 1000

/** Fixed v1 reason categories; extend later without renaming these. */
export const REASON_CATEGORIES = [
  'data_correction',
  'destructive',
  'privileged_settings',
  'revocation',
  'other',
] as const

export type ReasonCategory = (typeof REASON_CATEGORIES)[number]

export type ReasonSource = 'explicit' | 'commit-message'

export type ResolvedReason = {
  reason: string
  reason_source: ReasonSource
  category?: ReasonCategory
}

export type ReasonRejection = {
  code:
    | 'reason_required'
    | 'reason_too_short'
    | 'reason_category_required'
    | 'reason_category_invalid'
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

/** Create-shaped actions: new resources do not require a reason. */
const CREATE_ACTIONS = new Set([
  'namespace.create',
  'repo.create',
  'branch.create',
  'file.write',
])

/** Update / delete / privileged / destructive / revocation — reason required. */
const REASON_REQUIRED_ACTIONS = new Set([
  'file.delete',
  'branch.update',
  'branch.delete',
  'repo.delete',
  'repo.metadata',
  'namespace.update',
  'merge',
  'commit.publish',
  'workspace.commit',
  'workspace.merge',
  'privileged_settings',
  'revocation',
  'destructive',
])

export function isDatasetMutation(action: string): boolean {
  return DATASET_MUTATIONS.has(action)
}

/**
 * Whether this mutation class requires a reason (category + free text).
 * Creating new resources never requires one; updates, deletes, privileged settings,
 * destructive actions and revocation do.
 */
export function mutationNeedsReason(action: string): boolean {
  if (CREATE_ACTIONS.has(action)) return false
  if (REASON_REQUIRED_ACTIONS.has(action)) return true
  // Native privileged routes use the synthetic class name; unknown dataset mutations
  // that are not creates still fall through to the legacy dataset set minus creates.
  return isDatasetMutation(action) && !CREATE_ACTIONS.has(action)
}

const DEFAULT_DECLARED_TTL_SEC = 300
const MAX_DECLARED_TTL_SEC = 3600
/** In memory by design: a declaration is short-lived and a restart only means declaring again. */
const declared = new Map<
  string,
  { reason: string; expiresAt: number; category?: ReasonCategory; changeControlId?: string }
>()

/**
 * For clients that cannot send a header (the oxen binary): the caller states a reason once and it
 * applies to its next mutations for a short time. It counts as an explicit reason.
 */
export function declareReason(
  actor: { sub: string; iss: string },
  raw: unknown,
  ttlSec?: number,
  category?: string | null,
  changeControlId?: string | null,
): { ok: true; expiresAt: string } | { ok: false; error: string } {
  const reason = typeof raw === 'string' ? raw.trim() : ''
  if (reason.length < env.auditReasonMinLength || reason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `reason must be ${env.auditReasonMinLength}-${MAX_REASON_LENGTH} characters` }
  }
  let cat: ReasonCategory | undefined
  if (category != null && category !== '') {
    if (!isReasonCategory(category)) {
      return { ok: false, error: `reason category must be one of: ${REASON_CATEGORIES.join(', ')}` }
    }
    cat = category
  }
  const cc = typeof changeControlId === 'string' ? changeControlId.trim() : ''
  const ttl = Math.min(Math.max(1, Number.isFinite(ttlSec) ? (ttlSec as number) : DEFAULT_DECLARED_TTL_SEC), MAX_DECLARED_TTL_SEC)
  const expiresAt = currentClock.now() + ttl * 1000
  declared.set(principalKey(actor), {
    reason,
    expiresAt,
    ...(cat ? { category: cat } : {}),
    ...(cc ? { changeControlId: cc } : {}),
  })
  return { ok: true, expiresAt: new Date(expiresAt).toISOString() }
}

function declaredReason(actor: { sub: string; iss: string }): {
  reason: string
  category?: ReasonCategory
  changeControlId?: string
} | undefined {
  const d = declared.get(principalKey(actor))
  if (!d) return undefined
  if (d.expiresAt <= currentClock.now()) {
    declared.delete(principalKey(actor))
    return undefined
  }
  return {
    reason: d.reason,
    ...(d.category ? { category: d.category } : {}),
    ...(d.changeControlId ? { changeControlId: d.changeControlId } : {}),
  }
}

/** Change-control id from a prior `/auth/reason` declaration, if still valid. */
export function declaredChangeControlId(actor: { sub: string; iss: string }): string | undefined {
  return declaredReason(actor)?.changeControlId
}

const clean = (v: string | null | undefined): string => (v ?? '').trim().slice(0, MAX_REASON_LENGTH)

function isReasonCategory(v: string): v is ReasonCategory {
  return (REASON_CATEGORIES as readonly string[]).includes(v)
}

/**
 * Picks the reason for a mutation: an explicit one wins; otherwise fall back to the commit
 * message. A chosen reason shorter than the single minimum-length setting is rejected, never
 * silently replaced by a fallback.
 *
 * When `required` is true (GxP ticket 03 shape), a pick-list `category` is mandatory too.
 * Call sites that have not migrated omit `required` and keep text-only behaviour.
 */
export function resolveReason(input: {
  actor: { sub: string; iss: string }
  explicit?: string | null
  message?: string
  category?: string | null
  /** Full GxP shape: category + free text required. */
  required?: boolean
}): { ok: true; value: ResolvedReason } | { ok: false; rejection: ReasonRejection } {
  const min = env.auditReasonMinLength
  const declared = declaredReason(input.actor)
  const explicit = clean(input.explicit) || clean(declared?.reason)
  let picked: ResolvedReason | undefined
  if (explicit) picked = { reason: explicit, reason_source: 'explicit' }
  else {
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

  if (input.required) {
    const rawCategory = clean(input.category) || declared?.category || ''
    if (!rawCategory) {
      return {
        ok: false,
        rejection: {
          code: 'reason_category_required',
          detail: `A reason category is required: send one of ${REASON_CATEGORIES.join(', ')} in the X-Mice-Reason-Category header`,
        },
      }
    }
    if (!isReasonCategory(rawCategory)) {
      return {
        ok: false,
        rejection: {
          code: 'reason_category_invalid',
          detail: `Reason category must be one of: ${REASON_CATEGORIES.join(', ')}`,
        },
      }
    }
    picked = { ...picked, category: rawCategory }
  }

  return { ok: true, value: picked }
}
