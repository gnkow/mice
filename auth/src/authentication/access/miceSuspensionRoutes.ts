import type { Hono } from 'hono'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import type { AuditDep } from '../../routeDeps.js'
import { canonicalIssuer } from '../session/principal.js'
import { guarded } from '../session/routeGuard.js'
import { liftSuspension, suspendPrincipal, suspensionHistory } from './miceSuspension.js'

const adminGate = async (user: { sub: string; iss: string }) =>
  (await isInstanceAdmin(user)) ? null : 'Instance admin required'

/** Split `iss|sub` on the first bar. */
function principalFrom(raw: string): { iss: string; sub: string } | null {
  const bar = raw.indexOf('|')
  if (bar <= 0 || bar === raw.length - 1) return null
  return { iss: canonicalIssuer(raw.slice(0, bar)), sub: raw.slice(bar + 1) }
}

export function registerMiceSuspensionRoutes(app: Hono, _deps: AuditDep): void {
  app.post('/auth/admin/mice-suspension', guarded({
    gate: adminGate,
    mutates: true,
    reason: true,
    body: { required: ['principal', 'reason'] },
  }, async ({ c, user, body, audit }) => {
    const principal = principalFrom(String(body.principal))
    const reason = String(body.reason).trim()
    if (!principal) return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    if (!reason) return c.json({ error: 'Reason required' }, 400)

    const found = await suspendPrincipal(principal, { reason, actor: user })
    if (!found) return c.json({ error: 'Principal not found' }, 404)

    await audit({
      action: 'admin.mice_suspension.set',
      message: `Suspended ${principal.iss}|${principal.sub}`,
      detail: { principal: `${principal.iss}|${principal.sub}`, reason, actor: `${user.iss}|${user.sub}` },
    })
    return c.json({ ok: true })
  }))

  app.post('/auth/admin/mice-suspension/lift', guarded({
    gate: adminGate,
    mutates: true,
    reason: true,
    body: { required: ['principal', 'reason'] },
  }, async ({ c, user, body, audit }) => {
    const principal = principalFrom(String(body.principal))
    const reason = String(body.reason).trim()
    if (!principal) return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    if (!reason) return c.json({ error: 'Reason required' }, 400)

    const found = await liftSuspension(principal, { reason, actor: user })
    if (!found) return c.json({ error: 'Principal not found' }, 404)

    await audit({
      action: 'admin.mice_suspension.lift',
      message: `Lifted suspension of ${principal.iss}|${principal.sub}`,
      detail: { principal: `${principal.iss}|${principal.sub}`, reason, actor: `${user.iss}|${user.sub}` },
    })
    return c.json({ ok: true })
  }))

  app.get('/auth/admin/mice-suspension', guarded({
    gate: adminGate,
  }, async ({ c }) => {
    const principal = principalFrom(c.req.query('principal') ?? '')
    if (!principal) return c.json({ error: 'Invalid principal format (use iss|sub)' }, 400)
    const history = await suspensionHistory(principal)
    if (!history) return c.json({ error: 'Principal not found' }, 404)
    return c.json({ history })
  }))
}
