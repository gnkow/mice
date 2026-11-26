import type { Hono } from 'hono'
import { adminRoleGate } from '../../../authz/http.js'
import type { AuditDep } from '../../../shared/index.js'
import { canonicalIssuer } from '../session/principal.js'
import { guarded } from '../session/routeGuard.js'
import { isSuspended, liftSuspension, suspendPrincipal, suspensionHistory } from './miceSuspension.js'
import { requireAuditChange } from '../../../audit/change.js'
import { captureBefore } from '../../../audit/change.js'

/** Split `iss|sub` on the first bar. */
function principalFrom(raw: string): { iss: string; sub: string } | null {
  const bar = raw.indexOf('|')
  if (bar <= 0 || bar === raw.length - 1) return null
  return { iss: canonicalIssuer(raw.slice(0, bar)), sub: raw.slice(bar + 1) }
}

export function registerMiceSuspensionRoutes(app: Hono, _deps: AuditDep): void {
  app.post('/auth/admin/mice-suspension', guarded({
    gate: adminRoleGate,
    mutates: true,
    action: 'admin.mice_suspension.set',
    reason: true,
    body: { required: ['principal', 'reason'] },
  }, async ({ c, user, body, audit }) => {
    const principal = principalFrom(String(body.principal))
    const reason = String(body.reason).trim()
    if (!principal) return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    if (!reason) return c.json({ error: 'Reason required' }, 400)

    const before = await captureBefore(() => isSuspended(principal))
    const found = await suspendPrincipal(principal, { reason, actor: user })
    if (!found) return c.json({ error: 'Principal not found' }, 404)

    await audit({
      action: 'admin.mice_suspension.set',
      change: requireAuditChange({ mice_suspended: before }, { mice_suspended: await isSuspended(principal) }),
      message: `Suspended ${principal.iss}|${principal.sub}`,
      detail: { principal: `${principal.iss}|${principal.sub}`, reason, actor: `${user.iss}|${user.sub}` },
    })
    return c.json({ ok: true })
  }))

  app.post('/auth/admin/mice-suspension/lift', guarded({
    gate: adminRoleGate,
    mutates: true,
    action: 'admin.mice_suspension.lift',
    reason: true,
    body: { required: ['principal', 'reason'] },
  }, async ({ c, user, body, audit }) => {
    const principal = principalFrom(String(body.principal))
    const reason = String(body.reason).trim()
    if (!principal) return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    if (!reason) return c.json({ error: 'Reason required' }, 400)

    const before = await captureBefore(() => isSuspended(principal))
    const found = await liftSuspension(principal, { reason, actor: user })
    if (!found) return c.json({ error: 'Principal not found' }, 404)

    await audit({
      action: 'admin.mice_suspension.lift',
      change: requireAuditChange({ mice_suspended: before }, { mice_suspended: await isSuspended(principal) }),
      message: `Lifted suspension of ${principal.iss}|${principal.sub}`,
      detail: { principal: `${principal.iss}|${principal.sub}`, reason, actor: `${user.iss}|${user.sub}` },
    })
    return c.json({ ok: true })
  }))

  app.get('/auth/admin/mice-suspension', guarded({
    gate: adminRoleGate,
  }, async ({ c }) => {
    const principal = principalFrom(c.req.query('principal') ?? '')
    if (!principal) return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    const history = await suspensionHistory(principal)
    if (!history) return c.json({ error: 'Principal not found' }, 404)
    return c.json({ history })
  }))
}
