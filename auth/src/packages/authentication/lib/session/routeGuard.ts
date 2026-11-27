import type { Context, Handler } from 'hono'
import { actorFromUser } from '../../../audit/index.js'
import { appendAudit } from '../../../audit/index.js'
import { appendOutcomeFor, beginTrackedIntent, trackedIntent } from '../../../audit/index.js'
import { assertIntentAction, IntentActionError } from '../../../audit/index.js'
import { AuditChangeCaptureError } from '../../../audit/change.js'
import { EMPTY_AUDIT_CHANGE, NoChangeError } from '../../../audit/change.js'
import { auditUnavailableJson } from '../../../audit/index.js'
import { AuditDetailPolicyError } from '../../../audit/index.js'
import { declaredChangeControlId, REASON_HEADER, resolveReason, ResolvedReason } from '../../../audit/index.js'
import { intentReasonFields } from '../../../audit/index.js'
import { mutationSignatureAuditDetail } from '../signing/signingCeremony.js'
import type { SignatureRecord as StoredSignature } from '../signing/signatureStore.js'
import { allocateChangeControlId, CHANGE_CONTROL_HEADER, resolveChangeControl } from '../../../merge/index.js'
import { resolveMutationSignature, SIGNATURE_HEADER } from '../../../merge/index.js'
import { denialResponse } from '../../../authz/http.js'
import type { Decision } from '../../../authz/index.js'
import type { AuditFields } from '../../../shared/index.js'
import { authenticateOutcome, type AuthPolicy } from './requireAuth.js'
import type { SessionUser } from './session.js'

/**
 * `{ required }` parses a JSON object and 400s when a field is missing; `'json'` parses any
 * JSON value; `'optional'` tolerates an empty or invalid body as `{}`.
 */
export type BodySpec = { required: string[] } | 'json' | 'optional'

/**
 * The concrete operation a mutating route performs, named at Intent open time.
 *
 * - A catalogue action string (e.g. `merge_request.open`) when the route does one thing.
 * - A resolver when the operation depends on the request (e.g. approve vs deny from the body). It
 *   returns the action, or a `Response` that refuses the request before any Intent is written
 *   (the request names no operation, so nothing was attempted).
 *
 * Never `bff.mutation`, blank or missing: that is a bug and fails loudly (see
 * {@link assertIntentAction}), at route registration for strings and at request time for resolvers.
 */
export type GuardAction =
  | string
  | ((args: { c: GuardContext; body: Record<string, unknown> }) => string | Response)

type GuardPolicyBase = AuthPolicy & {
  /** Returns a denial message (answered 403), or null to allow. Runs before the body is read. */
  gate?: (user: SessionUser) => string | null | Promise<string | null>
  body?: BodySpec
  /**
   * The route changes admin or permission state, so it needs a reason (X-Mice-Reason header, at
   * least the configured minimum length). Rejected 400 before the intent is written.
   * When true, an e-signature is also required unless `signature: false`.
   */
  reason?: boolean
  /**
   * When `reason` is true, require a mutation e-signature (default true). Set false for
   * reason-only mutations (e.g. transfer reject/cancel).
   */
  signature?: boolean
  /** The 400 message for an unparseable body (default `Invalid body`). */
  invalidBody?: string
  /** Maps an error thrown by the handler to this route family's response; null rethrows. */
  fail?: (err: unknown, c: Context) => Response | null
}

/**
 * A mutating route (`mutates: true`) MUST name its operation: an Intent is appended before the
 * handler runs (503 when it cannot be stored), under `action`. Every `audit` call becomes its
 * Outcome; if the handler audits nothing, the Outcome is written under the same `action`.
 * There is no generic fallback: a missing action is a type error and throws when the route registers.
 */
export type GuardPolicy = GuardPolicyBase &
  ({ mutates: true; action: GuardAction } | { mutates?: false; action?: undefined })

/** A request context whose path params are strings: a guarded route always matched its own pattern. */
export type GuardContext = { req: { param(name: string): string } } & Context

export type BodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; res: Response }

export type GuardArgs = {
  c: GuardContext
  user: SessionUser
  via: 'session' | 'pat'
  body: Record<string, unknown>
  /** Appends an audit event for this native mutation, attributed to the caller. Never pass secrets in `detail`. */
  audit: (fields: AuditFields) => void
  /** The denial response for a decision (403 unless it says otherwise), or null when it allows. */
  deny: (d: Partial<Decision> & { allow: boolean }) => Response | null
  /** Reads the body on demand, for routes that must order other checks before a 400. */
  readBody: (spec?: BodySpec, invalidBody?: string) => Promise<BodyResult>
}

/** 400 `no_change` for a no-op mutation; 503 when the before-state could not be captured (fail-closed). */
export function changeCaptureResponse(err: unknown, c: Context): Response | null {
  if (err instanceof NoChangeError) return c.json({ error: 'No change', code: 'no_change' }, 400)
  if (err instanceof AuditChangeCaptureError) {
    return c.json({ error: err.message, code: 'audit_change_unavailable' }, 503)
  }
  return null
}

async function parseBody(c: Context, spec: BodySpec, invalid = 'Invalid body'): Promise<BodyResult> {
  let body: unknown = {}
  try {
    body = await c.req.json()
  } catch {
    if (spec !== 'optional') return { ok: false, res: c.json({ error: invalid }, 400) }
  }
  if (spec === 'optional') {
    return { ok: true, body: body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {} }
  }
  if (spec !== 'json') {
    const record = body as Record<string, unknown> | null
    // Present keys with empty string / 0 / false are valid; only absent/null/undefined are missing.
    // Empty merge-result manifests sign `content: ""` (sha256 of empty tree).
    const missing = spec.required.filter((f) => {
      if (!record || !Object.prototype.hasOwnProperty.call(record, f)) return true
      const v = record[f]
      return v === undefined || v === null
    })
    if (missing.length) {
      return { ok: false, res: c.json({ error: `${missing.join(' and ')} required` }, 400) }
    }
  }
  return { ok: true, body: body as Record<string, unknown> }
}

/**
 * The one entry for a native route: authenticate, gate (403), parse the body (400), run the
 * handler, shape its errors and expose audit. The handler never repeats those steps.
 */
export function guarded(
  policy: GuardPolicy,
  handler: (args: GuardArgs) => Response | Promise<Response>,
): Handler {
  const {
    gate,
    body: bodyPolicy,
    invalidBody,
    fail,
    mutates,
    reason: needsReason,
    signature: signaturePolicy,
    action: mutationAction,
    ...auth
  } = policy
  const needsSignature = Boolean(needsReason) && signaturePolicy !== false
  // Fail loudly when the route is registered, not when the first request arrives.
  const fixedAction =
    mutates && typeof mutationAction !== 'function'
      ? assertIntentAction(mutationAction, 'guarded({ mutates: true })')
      : undefined
  return async (c) => {
    const authed = await authenticateOutcome(c, auth)
    if (!authed.ok) return c.json({ error: authed.error }, authed.status)
    const { user, via } = authed
    const denial = await gate?.(user)
    if (denial) return c.json({ error: denial }, 403)

    let body: Record<string, unknown> = {}
    if (bodyPolicy) {
      const parsed = await parseBody(c, bodyPolicy, invalidBody)
      if (!parsed.ok) return parsed.res
      body = parsed.body
    } else if (needsReason) {
      // Need the body for the signed mutation document; handlers must use args.body.
      const parsed = await parseBody(c, 'optional')
      if (parsed.ok) body = parsed.body
    }
    const base = { actor: actorFromUser(user), via, method: c.req.method, path: c.req.path }
    // The operation this route performs, fixed before anything is written for the request.
    let intentAction = fixedAction
    if (mutates && typeof mutationAction === 'function') {
      const resolved = mutationAction({ c: c as unknown as GuardContext, body })
      if (resolved instanceof Response) return resolved
      intentAction = assertIntentAction(resolved, `${c.req.method} ${c.req.path}`)
    }
    let reason: ResolvedReason | undefined
    let changeControlId: string | undefined
    let signatureId: string | undefined
    let signatureRecord: StoredSignature | undefined
    if (needsReason) {
      const resolved = resolveReason({
        actor: user,
        explicit: c.req.header(REASON_HEADER),
      })
      if (!resolved.ok) {
        await appendAudit({
          ...base,
          status: 400,
          action: 'request.rejected',
          change: EMPTY_AUDIT_CHANGE,
          detail: { reason: resolved.rejection.code },
        })
        return c.json({ error: resolved.rejection.detail, code: resolved.rejection.code }, 400)
      }
      reason = resolved.value
      changeControlId = resolveChangeControl({
        id: c.req.header(CHANGE_CONTROL_HEADER) || declaredChangeControlId(user),
        required: false,
      })
      if (needsSignature) {
        const signed = await resolveMutationSignature({
          id: c.req.header(SIGNATURE_HEADER),
          signer: user,
          method: c.req.method,
          path: c.req.path,
          reason: reason.reason,
          body,
        })
        if (!signed.ok) {
          await appendAudit({
            ...base,
            status: 400,
            action: 'request.rejected',
            change: EMPTY_AUDIT_CHANGE,
            detail: { reason: signed.rejection.code },
          })
          return c.json({ error: signed.rejection.detail, code: signed.rejection.code }, 400)
        }
        signatureId = signed.signatureId
        signatureRecord = signed.record
        changeControlId =
          changeControlId || signed.record.changeControlId || allocateChangeControlId()
      }
    }
    const reasonFields = intentReasonFields({
      reason,
      changeControlId,
      signatureId,
    })
    const signatureDetail =
      signatureId && signatureRecord
        ? mutationSignatureAuditDetail(signatureId, signatureRecord)
        : undefined
    const withSignatureDetail = (detail?: Record<string, unknown>) =>
      signatureDetail || detail
        ? { detail: { ...signatureDetail, ...detail } }
        : {}
    if (mutates) {
      // The Intent names the real operation; there is no generic fallback. No action here is a bug.
      const action = assertIntentAction(intentAction, `${c.req.method} ${c.req.path}`)
      try {
        await beginTrackedIntent(c.req.raw, {
          ...base,
          ...reasonFields,
          ...withSignatureDetail(),
          status: 0,
          action,
          change: EMPTY_AUDIT_CHANGE,
        })
      } catch (err) {
        if (err instanceof IntentActionError) throw err
        if (err instanceof AuditDetailPolicyError) {
          return c.json({ error: err.message, code: err.code }, 400)
        }
        return c.json(auditUnavailableJson(), 503)
      }
    }
    const ctx = c as unknown as GuardContext
    const args: GuardArgs = {
      c: ctx,
      user,
      via,
      body,
      audit: async (f) => {
        await appendOutcomeFor(c.req.raw, {
          ...base,
          ...reasonFields,
          status: f.status ?? 200,
          action: f.action,
          change: f.change ?? EMPTY_AUDIT_CHANGE,
          ...(f.message ? { message: f.message } : {}),
          ...(f.namespace ? { namespace: f.namespace } : {}),
          ...(f.repo ? { repo: f.repo } : {}),
          ...(f.signature_id ? { signature_id: f.signature_id } : {}),
          ...(f.reason ? { reason: f.reason } : {}),
          ...(f.reason_source ? { reason_source: f.reason_source } : {}),
          ...(f.change_control_id ? { change_control_id: f.change_control_id } : {}),
          ...withSignatureDetail(f.detail),
        })
      },
      deny: (d) => denialResponse(c, d),
      readBody: (spec = 'json', invalid = invalidBody) => parseBody(c, spec, invalid),
    }
    // Handler audited nothing → the Outcome names the same operation the Intent did.
    const closeIntent = async (status: number) => {
      const tracked = trackedIntent(c.req.raw)
      if (tracked && tracked.outcomes === 0) {
        await appendOutcomeFor(c.req.raw, {
          ...base,
          ...reasonFields,
          ...withSignatureDetail(),
          status,
          action: assertIntentAction(intentAction, `${c.req.method} ${c.req.path}`),
          change: EMPTY_AUDIT_CHANGE,
        })
      }
    }
    let res: Response
    try {
      res = await handler(args)
    } catch (err) {
      // Change-capture failures are shared across every route family, so they map here before `fail`.
      // A no-op mutation is refused and never audited (the open intent closes with the 400 outcome).
      const shaped = changeCaptureResponse(err, c) ?? fail?.(err, c)
      await closeIntent(shaped?.status ?? 500)
      if (shaped) return shaped
      throw err
    }
    await closeIntent(res.status)
    return res
  }
}
