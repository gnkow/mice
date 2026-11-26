/**
 * Fail-closed responses when the audit store cannot accept an Intent event.
 * Mutations must refuse rather than proceed without a durable Intent (US3).
 */

/** User-facing copy when a mutation is refused because the audit store cannot accept an Intent. */
export const AUDIT_UNAVAILABLE_MESSAGE = 'audit unavailable, nothing was saved'

export const AUDIT_UNAVAILABLE_STATUS = 503 as const
export const AUDIT_UNAVAILABLE_RETRY_AFTER_SEC = '30'

/** Canonical oxen/proxy JSON body for Intent-append failure. */
export type AuditUnavailablePayload = {
  status: 'error'
  status_message: 'audit_unavailable'
  error: { detail: string }
}

export function auditUnavailablePayload(): AuditUnavailablePayload {
  return {
    status: 'error',
    status_message: 'audit_unavailable',
    error: { detail: AUDIT_UNAVAILABLE_MESSAGE },
  }
}

/** BFF/Hono JSON body used by {@link guarded} when Intent append fails. */
export function auditUnavailableJson(): { error: string } {
  return { error: AUDIT_UNAVAILABLE_MESSAGE }
}

/**
 * HTTP 503 for Intent-append failure — shared by the oxen proxy (and any caller that
 * returns a raw Response). Retry-After hints a short wait while the ledger recovers.
 */
export function auditUnavailableResponse(): Response {
  return new Response(JSON.stringify(auditUnavailablePayload()), {
    status: AUDIT_UNAVAILABLE_STATUS,
    headers: {
      'content-type': 'application/json',
      'retry-after': AUDIT_UNAVAILABLE_RETRY_AFTER_SEC,
    },
  })
}
