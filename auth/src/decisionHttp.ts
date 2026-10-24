import type { Context } from 'hono'
import { decideInstanceAction, type Decision, type InstanceAction } from './authz.js'
import type { SessionUser } from './session.js'

/** The denial response for a Decision, or null when it allows. Routes translate; they never decide. */
export function denialResponse(c: Context, d: Partial<Decision> & { allow: boolean }): Response | null {
  return d.allow ? null : c.json({ error: d.reason ?? 'Forbidden' }, (d.status ?? 403) as 403)
}

/** A route-guard gate for an instance action. */
export function instanceGate(action: InstanceAction): (user: SessionUser) => string | null {
  return (user) => {
    const d = decideInstanceAction(user, action)
    return d.allow ? null : d.reason
  }
}
