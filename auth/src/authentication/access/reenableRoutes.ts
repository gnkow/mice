import type { Hono } from 'hono'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import type { AuditDep } from '../../routeDeps.js'
import { canonicalIssuer } from '../session/principal.js'
import { guarded } from '../session/routeGuard.js'
import { confirmReenable, listReenablePeriods } from './reenable.js'

/** Split `iss|sub` on the first bar. */
function principalFrom(raw: string): { iss: string; sub: string } | null {
  const bar = raw.indexOf('|')
  if (bar <= 0 || bar === raw.length - 1) return null
  return { iss: canonicalIssuer(raw.slice(0, bar)), sub: raw.slice(bar + 1) }
}

const adminGate = async (user: { sub: string; iss: string }) =>
  (await isInstanceAdmin(user)) ? null : 'Instance admin required'

export function registerReenableRoutes(app: Hono, _deps: AuditDep): void {
  app.get('/auth/admin/re-enable', guarded({
    gate: adminGate,
  }, async ({ c }) => {
    return c.json({ periods: await listReenablePeriods() })
  }))

  app.post('/auth/admin/re-enable', guarded({
    gate: adminGate,
    mutates: true,
    reason: true,
    body: { required: ['principal'] },
  }, async ({ c, user, body, audit }) => {
    const principal = principalFrom(String(body.principal))
    if (!principal) return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    const event = await confirmReenable(principal, user)
    if (!event) return c.json({ error: 'Re-enable confirmation is not due' }, 409)
    await audit({
      action: 'auth.reenable.confirmed',
      message: event.message,
      detail: event.detail,
    })
    return c.json({ ok: true })
  }))
}
