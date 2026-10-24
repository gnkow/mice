import type { Hono } from 'hono'
import { preparePrincipal } from './authz.js'
import {
  addInstanceAdmin,
  isAuthzEnforce,
  isInstanceAdmin,
  listInstanceAdmins,
  listInstancePermissionGrants,
  removeInstanceAdmin,
  setAuthzEnforce,
  setInstancePermissions,
} from './authzStore.js'
import type { InstancePermission } from './authzTypes.js'
import { authenticateUser } from './requireAuth.js'
import type { AuditDep } from './routeDeps.js'

/** Instance settings, instance admins and instance permission grants. */
export function registerInstanceRoutes(app: Hono, { audit }: AuditDep): void {
  app.get('/auth/instance', async (c) => {
    const session = await authenticateUser(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    if (!isInstanceAdmin(session)) return c.json({ error: 'Forbidden' }, 403)
    return c.json({
      enforce: isAuthzEnforce(),
      admins: listInstanceAdmins(),
      permissions: listInstancePermissionGrants(),
    })
  })

  app.patch('/auth/instance', async (c) => {
    const session = await authenticateUser(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    if (!isInstanceAdmin(session)) return c.json({ error: 'Forbidden' }, 403)
    try {
      const body = (await c.req.json()) as { enforce?: boolean }
      if (typeof body.enforce === 'boolean') {
        const oldValue = isAuthzEnforce()
        setAuthzEnforce(body.enforce)
        audit(c, session, 'session', {
          action: 'instance.settings.update',
          message: `Updated instance enforce: ${oldValue} → ${body.enforce}`,
          detail: { enforce: body.enforce, previousEnforce: oldValue },
        })
      }
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    return c.json({ enforce: isAuthzEnforce() })
  })

  app.post('/auth/instance/admins', async (c) => {
    const session = await authenticateUser(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    let body: { sub?: string; iss?: string; email?: string }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.sub || !body.iss) {
      return c.json({ error: 'sub and iss required' }, 400)
    }
    const result = addInstanceAdmin(session, { sub: body.sub, iss: body.iss })
    if (!result.ok) {
      audit(c, session, 'session', {
        action: 'instance.admin.add',
        status: 403,
        message: `Add instance admin denied: ${result.error}`,
        detail: { target: { sub: body.sub, iss: body.iss } },
      })
      return c.json({ error: result.error }, 403)
    }
    audit(c, session, 'session', {
      action: 'instance.admin.add',
      message: `Added instance admin ${body.sub}`,
      detail: { target: { sub: body.sub, iss: body.iss } },
    })
    return c.json({ ok: true })
  })

  app.delete('/auth/instance/admins', async (c) => {
    const session = await authenticateUser(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    let body: { sub?: string; iss?: string }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.sub || !body.iss) {
      return c.json({ error: 'sub and iss required' }, 400)
    }
    const result = removeInstanceAdmin(session, { sub: body.sub, iss: body.iss })
    if (!result.ok) {
      audit(c, session, 'session', {
        action: 'instance.admin.remove',
        status: 400,
        message: `Remove instance admin failed: ${result.error}`,
        detail: { target: { sub: body.sub, iss: body.iss } },
      })
      return c.json({ error: result.error }, 400)
    }
    audit(c, session, 'session', {
      action: 'instance.admin.remove',
      message: `Removed instance admin ${body.sub}`,
      detail: { target: { sub: body.sub, iss: body.iss } },
    })
    return c.json({ ok: true })
  })

  app.put('/auth/instance/permissions', async (c) => {
    const session = await authenticateUser(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    let body: { sub?: string; iss?: string; permissions?: InstancePermission[] }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.sub || !body.iss || !Array.isArray(body.permissions)) {
      return c.json({ error: 'sub, iss, permissions required' }, 400)
    }
    const result = setInstancePermissions(
      session,
      { sub: body.sub, iss: body.iss },
      body.permissions,
    )
    if (!result.ok) {
      audit(c, session, 'session', {
        action: 'instance.permissions.update',
        status: 403,
        message: `Instance permissions update denied: ${result.error}`,
        detail: { target: { sub: body.sub, iss: body.iss } },
      })
      return c.json({ error: result.error }, 403)
    }
    audit(c, session, 'session', {
      action: 'instance.permissions.update',
      message: `Set instance permissions for ${body.sub}`,
      detail: {
        target: { sub: body.sub, iss: body.iss },
        permissions: body.permissions,
      },
    })
    return c.json({ ok: true })
  })
}
