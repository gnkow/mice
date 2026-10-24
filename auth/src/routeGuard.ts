import type { Context, Handler } from 'hono'
import { authenticateRequest, type AuthPolicy } from './requireAuth.js'
import type { SessionUser } from './session.js'

export type GuardPolicy = AuthPolicy & {
  /** Returns a denial message (answered 403), or null to allow. Runs before the body is read. */
  gate?: (user: SessionUser) => string | null
  /** `{ required }` parses a JSON object and 400s when a field is missing; `'optional'` tolerates an empty body. */
  body?: { required: string[] } | 'optional'
}

/** A request context whose path params are strings: a guarded route always matched its own pattern. */
export type GuardContext = { req: { param(name: string): string } } & Context

export type GuardArgs = {
  c: GuardContext
  user: SessionUser
  via: 'session' | 'pat'
  body: Record<string, unknown>
}

/**
 * Wraps a handler in the shared preamble: authenticate (401), gate (403), parse body (400).
 * The handler receives a prepared Principal and never repeats those steps.
 */
export function guarded(
  policy: GuardPolicy,
  handler: (args: GuardArgs) => Response | Promise<Response>,
): Handler {
  const { gate, body: bodyPolicy, ...auth } = policy
  return async (c) => {
    const authed = await authenticateRequest(c, auth)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const denial = gate?.(authed.user)
    if (denial) return c.json({ error: denial }, 403)

    let body: Record<string, unknown> = {}
    if (bodyPolicy) {
      try {
        body = (await c.req.json()) as Record<string, unknown>
      } catch {
        if (bodyPolicy !== 'optional') return c.json({ error: 'Invalid body' }, 400)
      }
      if (bodyPolicy !== 'optional') {
        if (bodyPolicy.required.some((f) => !body?.[f])) {
          return c.json({ error: `${bodyPolicy.required.join(' and ')} required` }, 400)
        }
      }
    }
    return handler({ c: c as unknown as GuardContext, ...authed, body })
  }
}
