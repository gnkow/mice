import type { Hono } from 'hono'
import { decideServicePrincipalManage } from './authz.js'
import { instanceGate } from './decisionHttp.js'
import { guarded, type GuardArgs, type GuardPolicy } from './routeGuard.js'
import { parsePatScopes } from './patScopes.js'
import { principalKey } from './principal.js'
import {
  createServicePrincipal,
  getServicePrincipal,
  listServicePrincipals,
  reassignServicePrincipal,
  updateServicePrincipalReason,
  serviceUser,
  type ServicePrincipal,
} from './servicePrincipals.js'
import { createPat, listPatsForUser, PatExpiryError, revokePat } from './tokens.js'

/** Admin-managed service principals (CI identities). Owners may also mint and revoke their PATs. */
export function registerServicePrincipalRoutes(app: Hono): void {
  const base = '/auth/instance/service-principals'

  const adminOnly = instanceGate('serviceprincipal.admin')

  app.get(base, guarded({ gate: adminOnly }, async ({ c }) => c.json({ servicePrincipals: await listServicePrincipals() })))

  app.post(base, guarded({ gate: adminOnly, mutates: true, reason: true, body: 'optional' }, async ({ c, audit, body }) => {
    const r = await createServicePrincipal({ name: (body.name as string | undefined) ?? '', owner: body.owner, reason: body.reason })
    if (!r.ok) return c.json({ error: r.error }, 400)
    await audit({
      action: 'service-principal.create',
      message: `Created service principal ${r.principal.name}`,
      detail: { id: r.principal.id, owner: { iss: r.principal.owner.iss, sub: r.principal.owner.sub } },
    })
    return c.json({ servicePrincipal: r.principal }, 201)
  }))

  app.patch(`${base}/:id`, guarded({ gate: adminOnly, mutates: true, reason: true, body: 'optional' }, async ({ c, audit, body }) => {
    const r = await updateServicePrincipalReason(c.req.param('id'), body.reason)
    if (!r.ok) return c.json({ error: r.error }, r.error === 'Not found' ? 404 : 400)
    await audit({
      action: 'service-principal.update',
      message: `Updated registered reason of service principal ${r.principal.name}`,
      detail: { id: r.principal.id, registeredReason: r.principal.reason ?? null },
    })
    return c.json({ servicePrincipal: r.principal })
  }))

  /** Admin or the current owner: 404 for an unknown principal, then the manage decision. */
  const managed = (
    policy: GuardPolicy,
    handler: (args: GuardArgs, sp: ServicePrincipal) => Response | Promise<Response>,
  ) =>
    guarded(policy, async (args) => {
      const sp = await getServicePrincipal(args.c.req.param('id'))
      if (!sp) return args.c.json({ error: 'Not found' }, 404)
      const denied = args.deny(await decideServicePrincipalManage(args.user, principalKey(sp.owner) === principalKey(args.user)))
      return denied ?? handler(args, sp)
    })

  app.get(`${base}/:id/tokens`, managed({}, async ({ c }, sp) => c.json({ tokens: listPatsForUser(serviceUser(sp)) })))

  app.post(`${base}/:id/tokens`, managed({ mutates: true, body: 'optional' }, async ({ c, audit, body: raw }, sp) => {
    const body = raw as { label?: string; scopes?: unknown; expiresInDays?: number }
    const parsed = parsePatScopes(body.scopes as never)
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)
    try {
      const { token, pat } = await createPat(serviceUser(sp), body.label?.trim() || 'CI token', {
        scopes: parsed.scopes,
        expiresInDays: body.expiresInDays,
      })
      await audit({
        action: 'token.create',
        message: `Created token for service principal ${sp.name}`,
        detail: { servicePrincipal: sp.id, tokenId: pat.id, expiresAt: pat.expiresAt },
      })
      return c.json({ token, pat }, 201)
    } catch (e) {
      if (e instanceof PatExpiryError) return c.json({ error: e.message }, 400)
      throw e
    }
  }))

  app.delete(`${base}/:id/tokens/:tokenId`, managed({ mutates: true }, async ({ c, audit }, sp) => {
    if (!(await revokePat(serviceUser(sp), c.req.param('tokenId')))) return c.json({ error: 'Token not found' }, 404)
    await audit({
      action: 'token.revoke',
      message: `Revoked token of service principal ${sp.name}`,
      detail: { servicePrincipal: sp.id, tokenId: c.req.param('tokenId') },
    })
    return c.json({ ok: true })
  }))

  app.post(`${base}/:id/reassign`, guarded({ gate: adminOnly, mutates: true, reason: true, body: 'optional' }, async ({ c, audit, body }) => {
    const r = await reassignServicePrincipal(c.req.param('id'), body.owner)
    if (!r.ok) return c.json({ error: r.error }, r.error === 'Not found' ? 404 : 400)
    await audit({
      action: 'service-principal.reassign',
      message: `Reassigned service principal ${r.principal.name} and reactivated it`,
      detail: { id: r.principal.id, owner: { iss: r.principal.owner.iss, sub: r.principal.owner.sub } },
    })
    return c.json({ servicePrincipal: r.principal })
  }))
}
