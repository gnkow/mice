import type { Context, Handler } from 'hono'
import { actorFromUser, appendAudit } from './audit.js'
import { denialResponse } from './decisionHttp.js'
import type { Decision } from './authz.js'
import type { AuditFields } from './routeDeps.js'
import { authenticateOutcome, type AuthPolicy } from './requireAuth.js'
import type { SessionUser } from './session.js'

/**
 * `{ required }` parses a JSON object and 400s when a field is missing; `'json'` parses any
 * JSON value; `'optional'` tolerates an empty or invalid body as `{}`.
 */
export type BodySpec = { required: string[] } | 'json' | 'optional'

export type GuardPolicy = AuthPolicy & {
  /** Returns a denial message (answered 403), or null to allow. Runs before the body is read. */
  gate?: (user: SessionUser) => string | null
  body?: BodySpec
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
  const { gate, body: bodyPolicy, invalidBody, fail, ...auth } = policy
  return async (c) => {
    const authed = await authenticateOutcome(c, auth)
    if (!authed.ok) return c.json({ error: authed.error }, authed.status)
    const { user, via } = authed
    const denial = gate?.(user)
    if (denial) return c.json({ error: denial }, 403)

    let body: Record<string, unknown> = {}
    if (bodyPolicy) {
      const parsed = await parseBody(c, bodyPolicy, invalidBody)
      if (!parsed.ok) return parsed.res
      body = parsed.body
    }
    const ctx = c as unknown as GuardContext
    const args: GuardArgs = {
      c: ctx,
      user,
      via,
      body,
      audit: (f) =>
        void appendAudit({
          actor: actorFromUser(user),
          via,
          method: c.req.method,
          path: c.req.path,
          status: f.status ?? 200,
          action: f.action,
          ...(f.message ? { message: f.message } : {}),
          ...(f.namespace ? { namespace: f.namespace } : {}),
          ...(f.repo ? { repo: f.repo } : {}),
          ...(f.detail ? { detail: f.detail } : {}),
        }),
      deny: (d) => denialResponse(c, d),
      readBody: (spec = 'json', invalid = invalidBody) => parseBody(c, spec, invalid),
    }
    if (!fail) return handler(args)
    try {
      return await handler(args)
    } catch (err) {
      const shaped = fail(err, c)
      if (shaped) return shaped
      throw err
    }
  }
}
