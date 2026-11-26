import { EMPTY_AUDIT_CHANGE } from '../../audit/change.js'
import { actorFromUser } from '../../audit/index.js'
import { appendAudit } from '../../audit/index.js'
import type { AuditVia } from '../../audit/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { ReasonRejection } from '../../audit/index.js'
import type { MutationSignatureRejection } from '../../merge/index.js'

export async function rejectUnclassifiedWrite(
  user: SessionUser,
  via: AuditVia,
  method: string,
  pathname: string,
  reason: string,
  scope: { namespace?: string; repo?: string } = {},
): Promise<Response> {
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method,
    path: pathname,
    status: 400,
    action: 'request.rejected',
    change: EMPTY_AUDIT_CHANGE,
    ...(scope.namespace ? { namespace: scope.namespace } : {}),
    ...(scope.repo ? { repo: scope.repo } : {}),
    detail: { reason },
  })
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: 'bad_request',
      error: { detail: 'Request body could not be classified' },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

/** Mutating path that is not a known Oxen operation — refuse; do not write an operation audit. */
export async function rejectUnsupportedOperation(
  user: SessionUser,
  via: AuditVia,
  method: string,
  pathname: string,
  scope: { namespace?: string; repo?: string } = {},
): Promise<Response> {
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method,
    path: pathname,
    status: 400,
    action: 'request.rejected',
    change: EMPTY_AUDIT_CHANGE,
    ...(scope.namespace ? { namespace: scope.namespace } : {}),
    ...(scope.repo ? { repo: scope.repo } : {}),
    detail: { reason: 'unsupported_operation' },
  })
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: 'bad_request',
      error: { detail: 'Unsupported or unknown API operation' },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

export async function rejectReason(
  user: SessionUser,
  via: AuditVia,
  method: string,
  pathname: string,
  rejection: ReasonRejection,
  scope: { namespace?: string; repo?: string },
): Promise<Response> {
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method,
    path: pathname,
    status: 400,
    action: 'request.rejected',
    change: EMPTY_AUDIT_CHANGE,
    ...(scope.namespace ? { namespace: scope.namespace } : {}),
    ...(scope.repo ? { repo: scope.repo } : {}),
    detail: { reason: rejection.code },
  })
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: rejection.code,
      error: { detail: rejection.detail },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

export async function rejectSignature(
  user: SessionUser,
  via: AuditVia,
  method: string,
  pathname: string,
  rejection: MutationSignatureRejection,
  scope: { namespace?: string; repo?: string },
): Promise<Response> {
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method,
    path: pathname,
    status: 400,
    action: 'request.rejected',
    change: EMPTY_AUDIT_CHANGE,
    ...(scope.namespace ? { namespace: scope.namespace } : {}),
    ...(scope.repo ? { repo: scope.repo } : {}),
    detail: { reason: rejection.code },
  })
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: rejection.code,
      error: { detail: rejection.detail },
      code: rejection.code,
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

export function auditChainBroken(): Response {
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: 'audit_chain_broken',
      error: { detail: 'Audit chain verification failed; dataset changes are blocked until an instance admin acknowledges it' },
    }),
    { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '300' } },
  )
}

/** Before-state could not be read: refuse rather than audit a guessed change (fail closed). */
export function changeUnavailableResponse(): Response {
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: 'unavailable',
      error: { detail: 'Audit change could not be captured', code: 'audit_change_unavailable' },
    }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  )
}

/** The mutation left the state as it was. */
export function noChangeResponse(): Response {
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: 'bad_request',
      error: { detail: 'No change', code: 'no_change' },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}
