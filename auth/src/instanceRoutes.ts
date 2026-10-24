import type { Hono } from 'hono'
import { addInstanceAdmin, isAuthzEnforce, listInstanceAdmins, listInstancePermissionGrants, removeInstanceAdmin, setAuthzEnforce, setInstancePermissions } from './authzInstanceStore.js'
import type { InstancePermission } from './authzTypes.js'
import { instanceGate } from './decisionHttp.js'
import { guarded } from './routeGuard.js'
import type { AuditDep } from './routeDeps.js'

const adminOnly = instanceGate('instance.admin')
const target = (b: Record<string, unknown>) => ({ sub: b.sub as string, iss: b.iss as string })

/** Instance settings, instance admins and instance permission grants. */
export function registerInstanceRoutes(app: Hono, { audit }: AuditDep): void {
  app.get(
    '/auth/instance',
    guarded({ gate: adminOnly }, ({ c }) =>
      c.json({
        enforce: isAuthzEnforce(),
        admins: listInstanceAdmins(),
        permissions: listInstancePermissionGrants(),
      }),
    ),
  )

  app.patch(
    '/auth/instance',
    guarded({ gate: adminOnly, body: { required: [] } }, ({ c, user, body }) => {
      if (typeof body.enforce === 'boolean') {
        const oldValue = isAuthzEnforce()
        setAuthzEnforce(body.enforce)
        audit(c, user, 'session', {
          action: 'instance.settings.update',
          message: `Updated instance enforce: ${oldValue} → ${body.enforce}`,
          detail: { enforce: body.enforce, previousEnforce: oldValue },
        })
      }
      return c.json({ enforce: isAuthzEnforce() })
    }),
  )

  app.post(
    '/auth/instance/admins',
    guarded({ body: { required: ['sub', 'iss'] } }, ({ c, user, body }) => {
      const t = target(body)
      const result = addInstanceAdmin(user, t)
      if (!result.ok) {
        audit(c, user, 'session', {
          action: 'instance.admin.add',
          status: 403,
          message: `Add instance admin denied: ${result.error}`,
          detail: { target: t },
        })
        return c.json({ error: result.error }, 403)
      }
      audit(c, user, 'session', {
        action: 'instance.admin.add',
        message: `Added instance admin ${t.sub}`,
        detail: { target: t },
      })
      return c.json({ ok: true })
    }),
  )

  app.delete(
    '/auth/instance/admins',
    guarded({ body: { required: ['sub', 'iss'] } }, ({ c, user, body }) => {
      const t = target(body)
      const result = removeInstanceAdmin(user, t)
      if (!result.ok) {
        audit(c, user, 'session', {
          action: 'instance.admin.remove',
          status: 400,
          message: `Remove instance admin failed: ${result.error}`,
          detail: { target: t },
        })
        return c.json({ error: result.error }, 400)
      }
      audit(c, user, 'session', {
        action: 'instance.admin.remove',
        message: `Removed instance admin ${t.sub}`,
        detail: { target: t },
      })
      return c.json({ ok: true })
    }),
  )

  app.put(
    '/auth/instance/permissions',
    guarded({ body: { required: [] } }, ({ c, user, body }) => {
      if (!body.sub || !body.iss || !Array.isArray(body.permissions)) {
        return c.json({ error: 'sub, iss, permissions required' }, 400)
      }
      const permissions = body.permissions as InstancePermission[]
      const t = target(body)
      const result = setInstancePermissions(user, t, permissions)
      if (!result.ok) {
        audit(c, user, 'session', {
          action: 'instance.permissions.update',
          status: 403,
          message: `Instance permissions update denied: ${result.error}`,
          detail: { target: t },
        })
        return c.json({ error: result.error }, 403)
      }
      audit(c, user, 'session', {
        action: 'instance.permissions.update',
        message: `Set instance permissions for ${t.sub}`,
        detail: { target: t, permissions },
      })
      return c.json({ ok: true })
    }),
  )
}
