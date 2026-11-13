import type { Context, Handler } from 'hono'
import {
  actorFromUser,
  appendAudit,
  appendOutcomeFor,
  AUDIT_UNAVAILABLE_MESSAGE,
  beginTrackedIntent,
  trackedIntent,
} from '../../audit.js'
import { AuditDetailPolicyError } from '../../auditDetailPolicy.js'
import {
  declaredChangeControlId,
  REASON_CATEGORY_HEADER,
  REASON_HEADER,
  resolveReason,
  type ResolvedReason,
} from '../../auditReason.js'
import {
  allocateChangeControlId,
  CHANGE_CONTROL_HEADER,
  resolveChangeControl,
} from '../../changeControl.js'
import {
  resolveMutationSignature,
  SIGNATURE_HEADER,
} from '../../mutationSignature.js'
import { denialResponse } from '../../decisionHttp.js'
import type { Decision } from '../../authz.js'
import type { AuditFields } from '../../routeDeps.js'
import { authenticateOutcome, type AuthPolicy } from './requireAuth.js'
import type { SessionUser } from './session.js'

/**
 * `{ required }` parses a JSON object and 400s when a field is missing; `'json'` parses any
 * JSON value; `'optional'` tolerates an empty or invalid body as `{}`.
 */
export type BodySpec = { required: string[] } | 'json' | 'optional'

export type GuardPolicy = AuthPolicy & {
  /** Returns a denial message (answered 403), or null to allow. Runs before the body is read. */
  gate?: (user: SessionUser) => string | null | Promise<string | null>
  body?: BodySpec
  /**
   * The route changes data or access. An intent event is appended before the handler runs (503
   * when it cannot be stored, handler never runs) and every `audit` call becomes its outcome.
   * A handler that audits nothing gets an outcome carrying the response status.
   */
  mutates?: boolean
  /**
   * The route changes admin or permission state, so it needs a reason (X-Mice-Reason header, at
   * least the configured minimum length). Rejected 400 before the intent is written.
   */
  reason?: boolean
  /** The 400 message for an unparseable body (default `Invalid body`). */
  invalidBody?: string
  /** Maps an error thrown by the handler to this route family's response; null rethrows. */
  fail?: (err: unknown, c: Context) => Response | null
}

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
  if (spec !== 'json' && spec.required.some((f) => !(body as Record<string, unknown> | null)?.[f])) {
    return { ok: false, res: c.json({ error: `${spec.required.join(' and ')} required` }, 400) }
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
  const { gate, body: bodyPolicy, invalidBody, fail, mutates, reason: needsReason, ...auth } = policy
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
      body = parsed.body
    }
    const base = { actor: actorFromUser(user), via, method: c.req.method, path: c.req.path }
    let reason: ResolvedReason | undefined
    let changeControlId: string | undefined
    let signatureId: string | undefined
    if (needsReason) {
      const resolved = resolveReason({
        actor: user,
        explicit: c.req.header(REASON_HEADER),
        category: c.req.header(REASON_CATEGORY_HEADER),
        required: true,
      })
      if (!resolved.ok) {
        await appendAudit({ ...base, status: 400, action: 'request.rejected', detail: { reason: resolved.rejection.code } })
        return c.json({ error: resolved.rejection.detail, code: resolved.rejection.code }, 400)
      }
      reason = resolved.value
      changeControlId = resolveChangeControl({
        id: c.req.header(CHANGE_CONTROL_HEADER) || declaredChangeControlId(user),
        required: false,
      })
      const signed = await resolveMutationSignature({
        id: c.req.header(SIGNATURE_HEADER),
        signer: user,
        method: c.req.method,
        path: c.req.path,
        reason: reason.reason,
        category: reason.category ?? '',
        body,
      })
      if (!signed.ok) {
        await appendAudit({
          ...base,
          status: 400,
          action: 'request.rejected',
          detail: { reason: signed.rejection.code },
        })
        return c.json({ error: signed.rejection.detail, code: signed.rejection.code }, 400)
      }
      signatureId = signed.signatureId
      changeControlId =
        changeControlId || signed.record.changeControlId || allocateChangeControlId()
    }
    const reasonFields = {
      ...reason,
      ...(changeControlId ? { change_control_id: changeControlId } : {}),
      ...(signatureId ? { signature_id: signatureId } : {}),
    }
    if (mutates) {
      try {
        await beginTrackedIntent(c.req.raw, { ...base, ...reasonFields, status: 0, action: 'bff.mutation' })
      } catch (err) {
        if (err instanceof AuditDetailPolicyError) {
          return c.json({ error: err.message, code: err.code }, 400)
        }
        return c.json({ error: AUDIT_UNAVAILABLE_MESSAGE }, 503)
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
          ...(f.message ? { message: f.message } : {}),
          ...(f.namespace ? { namespace: f.namespace } : {}),
          ...(f.repo ? { repo: f.repo } : {}),
          ...(f.detail ? { detail: f.detail } : {}),
        })
      },
      deny: (d) => denialResponse(c, d),
      readBody: (spec = 'json', invalid = invalidBody) => parseBody(c, spec, invalid),
    }
    // A mutation whose handler audited nothing still gets its outcome, so no intent is left dangling.
    const closeIntent = async (status: number) => {
      const tracked = trackedIntent(c.req.raw)
      if (tracked && tracked.outcomes === 0) {
        await appendOutcomeFor(c.req.raw, { ...base, ...reasonFields, status, action: 'bff.mutation' })
      }
    }
    let res: Response
    try {
      res = await handler(args)
    } catch (err) {
      const shaped = fail?.(err, c)
      await closeIntent(shaped?.status ?? 500)
      if (shaped) return shaped
      throw err
    }
    await closeIntent(res.status)
    return res
  }
}
