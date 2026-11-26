import type { Context } from 'hono'
import type { SessionUser } from '../../authentication/principal.js'
import {
  declaredChangeControlId,
  mutationNeedsReason,
  REASON_HEADER,
  resolveReason,
  type ResolvedReason,
} from '../../audit/index.js'
import { allocateChangeControlId, CHANGE_CONTROL_HEADER, mutationNeedsChangeControl, resolveChangeControl } from '../../merge/index.js'
import { resolveMutationSignature, SIGNATURE_HEADER } from '../../merge/index.js'
import type { SignatureRecord as StoredSignature } from '../../authentication/signing.js'
import { rejectReason, rejectSignature } from './proxyReject.js'
import type { AuditVia } from '../../audit/index.js'

export type MutationControls = {
  reason?: ResolvedReason
  changeControlId?: string
  signatureId?: string
  signatureRecord?: StoredSignature
}

export type MutationControlsResult =
  | { ok: true; controls: MutationControls }
  | { ok: false; response: Response }

/** Resolve reason / signature / change-control for a mutating request. */
export async function resolveMutationControls(input: {
  c: Context
  user: SessionUser
  via: AuditVia
  method: string
  pathname: string
  action: string
  message: string | undefined
  signatureBody: unknown
  ns: string | undefined
  repo: string | undefined
  mutating: boolean
}): Promise<MutationControlsResult> {
  const { c, user, via, method, pathname, action, message, signatureBody, ns, repo, mutating } = input
  let reason: ResolvedReason | undefined
  let changeControlId: string | undefined
  let signatureId: string | undefined
  let signatureRecord: StoredSignature | undefined

  if (mutating && mutationNeedsReason(action)) {
    const resolved = resolveReason({
      actor: user,
      explicit: c.req.header(REASON_HEADER),
      message,
    })
    if (!resolved.ok) {
      return {
        ok: false,
        response: await rejectReason(user, via, method, pathname, resolved.rejection, {
          namespace: ns,
          repo,
        }),
      }
    }
    reason = resolved.value
    changeControlId = resolveChangeControl({
      id: c.req.header(CHANGE_CONTROL_HEADER) || declaredChangeControlId(user),
      required: false,
    })
    const signed = await resolveMutationSignature({
      id: c.req.header(SIGNATURE_HEADER),
      signer: user,
      method,
      path: pathname,
      reason: reason.reason,
      body: signatureBody,
    })
    if (!signed.ok) {
      return {
        ok: false,
        response: await rejectSignature(user, via, method, pathname, signed.rejection, {
          namespace: ns,
          repo,
        }),
      }
    }
    signatureId = signed.signatureId
    signatureRecord = signed.record
    changeControlId =
      changeControlId || signed.record.changeControlId || allocateChangeControlId()
  } else if (mutating && mutationNeedsChangeControl(action)) {
    changeControlId = resolveChangeControl({
      id: c.req.header(CHANGE_CONTROL_HEADER) || declaredChangeControlId(user),
      required: true,
    })
  }

  return { ok: true, controls: { reason, changeControlId, signatureId, signatureRecord } }
}
