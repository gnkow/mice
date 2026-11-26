import type { Hono } from 'hono'
import { guarded } from '../../authentication/session.js'
import type { AuditDep } from '../../shared/index.js'
import { getUserRole, listRbacUsers } from './rbacStore.js'
import { orchestratePermissionGrant, orchestrateRoleGrant } from './rbacGrantHelpers.js'

/** Direct role and custom-permission grants (Settings → Grant Access). */
export function registerRbacGrantRoutes(app: Hono, { audit }: AuditDep): void {
  const reviewerOnly = async (u: { sub: string; iss: string }) => {
    const role = await getUserRole(u)
    return role === 'manager' || role === 'admin' ? null : 'Forbidden'
  }

  app.get(
    '/auth/grants/users',
    guarded({ gate: reviewerOnly }, async ({ c }) => {
      return c.json({ users: await listRbacUsers() })
    }),
  )

  app.post(
    '/auth/grants/role',
    guarded(
      { mutates: true, action: 'access.grant.role', reason: true, gate: reviewerOnly, body: { required: ['sub', 'iss', 'role'] } },
      async ({ c, user, body }) => {
        const result = await orchestrateRoleGrant({ c, user, body, audit })
        if (!result.ok) return c.json(result.body, result.status)
        return c.json(result.body)
      },
    ),
  )

  app.post(
    '/auth/grants/permissions',
    guarded(
      {
        mutates: true,
        action: 'access.grant.permissions',
        reason: true,
        gate: reviewerOnly,
        body: { required: ['sub', 'iss', 'permissions'] },
      },
      async ({ c, user, body }) => {
        const result = await orchestratePermissionGrant({ c, user, body, audit })
        if (!result.ok) return c.json(result.body, result.status)
        return c.json(result.body)
      },
    ),
  )
}
