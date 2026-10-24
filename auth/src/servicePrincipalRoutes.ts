import type { Context, Hono } from 'hono'
import { isInstanceAdmin } from './authzStore.js'
import { authenticateUser } from './requireAuth.js'
import { guarded } from './routeGuard.js'
import { parsePatScopes } from './patScopes.js'
import { principalKey } from './principal.js'
import {
  createServicePrincipal,
  getServicePrincipal,
  listServicePrincipals,
  reassignServicePrincipal,
  serviceUser,
} from './servicePrincipals.js'
import type { SessionUser } from './session.js'
import { createPat, listPatsForUser, PatExpiryError, revokePat } from './tokens.js'

type Deps = {
  audit: (
    c: Context,
    user: SessionUser,
    fields: { action: string; message: string; status?: number; detail?: Record<string, unknown> },
  ) => void
}

/** Admin-managed service principals (CI identities). Owners may also mint and revoke their PATs. */
export function registerServicePrincipalRoutes(app: Hono, { audit }: Deps): void {
  const base = '/auth/instance/service-principals'

  const adminOnly = (u: SessionUser) => (isInstanceAdmin(u) ? null : 'Instance admin required')

  app.get(base, guarded({ gate: adminOnly }, ({ c }) => c.json({ servicePrincipals: listServicePrincipals() })))

  app.post(base, guarded({ gate: adminOnly, body: 'optional' }, ({ c, user: s, body }) => {
    const r = createServicePrincipal({ name: (body.name as string | undefined) ?? '', owner: body.owner })
    if (!r.ok) return c.json({ error: r.error }, 400)
    audit(c, s, {
      action: 'service-principal.create',
      message: `Created service principal ${r.principal.name}`,
      detail: { id: r.principal.id, owner: { iss: r.principal.owner.iss, sub: r.principal.owner.sub } },
    })
    return c.json({ servicePrincipal: r.principal }, 201)
  }))

  /** Admin or the current owner; null with a response when denied. */
  async function manage(c: Context) {
    const s = await authenticateUser(c)
    if (!s) return { res: c.json({ error: 'Authentication required' }, 401) }
    const sp = getServicePrincipal(c.req.param('id') ?? '')
    if (!sp) return { res: c.json({ error: 'Not found' }, 404) }
    if (!isInstanceAdmin(s) && principalKey(sp.owner) !== principalKey(s)) {
      return { res: c.json({ error: 'Forbidden' }, 403) }
    }
    return { s, sp }
  }

  app.get(`${base}/:id/tokens`, async (c) => {
    const m = await manage(c)
    if (!m.sp) return m.res!
    return c.json({ tokens: listPatsForUser(serviceUser(m.sp)) })
  })

  app.post(`${base}/:id/tokens`, async (c) => {
    const m = await manage(c)
    if (!m.sp || !m.s) return m.res!
    const body = (await c.req.json().catch(() => ({}))) as {
      label?: string
      scopes?: unknown
      expiresInDays?: number
    }
    const parsed = parsePatScopes(body.scopes as never)
    if (!parsed.ok) return c.json({ error: parsed.error }, 400)
    try {
      const { token, pat } = createPat(serviceUser(m.sp), body.label?.trim() || 'CI token', {
        scopes: parsed.scopes,
        expiresInDays: body.expiresInDays,
      })
      audit(c, m.s, {
        action: 'token.create',
        message: `Created token for service principal ${m.sp.name}`,
        detail: { servicePrincipal: m.sp.id, tokenId: pat.id, expiresAt: pat.expiresAt },
      })
      return c.json({ token, pat }, 201)
    } catch (e) {
      if (e instanceof PatExpiryError) return c.json({ error: e.message }, 400)
      throw e
    }
  })

  app.delete(`${base}/:id/tokens/:tokenId`, async (c) => {
    const m = await manage(c)
    if (!m.sp || !m.s) return m.res!
    if (!revokePat(serviceUser(m.sp), c.req.param('tokenId') ?? '')) return c.json({ error: 'Token not found' }, 404)
    audit(c, m.s, {
      action: 'token.revoke',
      message: `Revoked token of service principal ${m.sp.name}`,
      detail: { servicePrincipal: m.sp.id, tokenId: c.req.param('tokenId') },
    })
    return c.json({ ok: true })
  })

  app.post(`${base}/:id/reassign`, async (c) => {
    const s = await authenticateUser(c)
    if (!s) return c.json({ error: 'Authentication required' }, 401)
    if (!isInstanceAdmin(s)) return c.json({ error: 'Instance admin required' }, 403)
    const body = (await c.req.json().catch(() => ({}))) as { owner?: unknown }
    const r = reassignServicePrincipal(c.req.param('id') ?? '', body.owner)
    if (!r.ok) return c.json({ error: r.error }, r.error === 'Not found' ? 404 : 400)
    audit(c, s, {
      action: 'service-principal.reassign',
      message: `Reassigned service principal ${r.principal.name} and reactivated it`,
      detail: { id: r.principal.id, owner: { iss: r.principal.owner.iss, sub: r.principal.owner.sub } },
    })
    return c.json({ servicePrincipal: r.principal })
  })
}
