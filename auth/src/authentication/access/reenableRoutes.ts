import type { Hono } from 'hono'
import { adminRoleGate } from '../../decisionHttp.js'
import type { AuditDep } from '../../routeDeps.js'
import { canonicalIssuer } from '../session/principal.js'
import { guarded } from '../session/routeGuard.js'
import { confirmReenable, disabledPeriodAuditState, listReenablePeriods } from './reenable.js'
import { requireAuditChange } from '../../auditChange.js'
import { captureBefore } from '../../auditCapture.js'

/** Split `iss|sub` on the first bar. */
function principalFrom(raw: string): { iss: string; sub: string } | null {
  const bar = raw.indexOf('|')
  if (bar <= 0 || bar === raw.length - 1) return null
  return { iss: canonicalIssuer(raw.slice(0, bar)), sub: raw.slice(bar + 1) }
}

export function registerReenableRoutes(app: Hono, _deps: AuditDep): void {
  app.get('/auth/admin/re-enable', guarded({
    gate: adminRoleGate,
  }, async ({ c }) => {
    return c.json({ periods: await listReenablePeriods() })
  }))

  app.post('/auth/admin/re-enable', guarded({
    gate: adminRoleGate,
    mutates: true,
    action: 'auth.reenable.confirmed',
    reason: true,
    body: { required: ['principal'] },
  }, async ({ c, user, body, audit }) => {
    const principal = principalFrom(String(body.principal))
    if (!principal) return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    const before = await captureBefore(() => disabledPeriodAuditState(principal))
    const event = await confirmReenable(principal, user)
    if (!event) return c.json({ error: 'Re-enable confirmation is not due' }, 409)
    await audit({
      action: 'auth.reenable.confirmed',
      change: requireAuditChange(before, await disabledPeriodAuditState(principal)),
      message: event.message,
      detail: event.detail,
    })
    return c.json({ ok: true })
  }))
}
