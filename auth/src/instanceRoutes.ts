import { and, eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { addInstanceAdmin, listInstanceAdmins, listInstancePermissionGrants, removeInstanceAdmin, setInstancePermissions } from './authzInstanceStore.js'
import { matchesBootstrap } from './authzRepository.js'
import type { InstancePermission } from './authzTypes.js'
import { canonicalIssuer } from './authentication/session/principal.js'
import { instanceGate } from './decisionHttp.js'
import { guarded } from './authentication/index.js'
import { getDb } from './db/database.js'
import { principals } from './db/schema.js'
import type { AuditDep } from './routeDeps.js'
import { checkGroupBindingMode, getGroupBindingStatus } from './groupBindingStatusStore.js'

async function adminViews() {
  const admins = await listInstanceAdmins()
  return Promise.all(admins.map(async (admin) => {
    const [row] = await getDb()
      .select({ email: principals.email, name: principals.name })
      .from(principals)
      .where(and(eq(principals.iss, canonicalIssuer(admin.iss)), eq(principals.sub, admin.sub)))
      .limit(1)
    const email = row?.email ?? ''
    return {
      sub: admin.sub,
      iss: admin.iss,
      email: email || null,
      name: row?.name ?? null,
      bootstrap: matchesBootstrap({
        sub: admin.sub,
        iss: admin.iss,
        email,
        emailVerified: email.length > 0,
        name: row?.name ?? '',
      }),
    }
  }))
}

const adminOnly = instanceGate('instance.admin')
const target = (b: Record<string, unknown>) => ({ sub: b.sub as string, iss: b.iss as string })

/** Instance settings, instance admins and instance permission grants. */
export function registerInstanceRoutes(app: Hono, { audit }: AuditDep): void {
  app.get(
    '/auth/instance',
    guarded({ gate: adminOnly }, async ({ c }) =>
      c.json({
        enforce: true,
        admins: await adminViews(),
        permissions: await listInstancePermissionGrants(),
      }),
    ),
  )

  app.post(
    '/auth/instance/admins',
    guarded({ mutates: true, reason: true, body: { required: ['sub', 'iss'] } }, async ({ c, user, body }) => {
      const t = target(body)
      const result = await addInstanceAdmin(user, t)
      if (!result.ok) {
        await audit(c, user, 'session', {
          action: 'instance.admin.add',
          status: 403,
          message: `Add instance admin denied: ${result.error}`,
          detail: { target: t },
        })
        return c.json({ error: result.error }, 403)
      }
      await audit(c, user, 'session', {
        action: 'instance.admin.add',
        message: `Added instance admin ${t.sub}`,
        detail: { target: t },
      })
      return c.json({ ok: true })
    }),
  )

  app.delete(
    '/auth/instance/admins',
    guarded({ mutates: true, reason: true, body: { required: ['sub', 'iss'] } }, async ({ c, user, body }) => {
      const t = target(body)
      const result = await removeInstanceAdmin(user, t)
      if (!result.ok) {
        await audit(c, user, 'session', {
          action: 'instance.admin.remove',
          status: 400,
          message: `Remove instance admin failed: ${result.error}`,
          detail: { target: t },
        })
        return c.json({ error: result.error }, 400)
      }
      await audit(c, user, 'session', {
        action: 'instance.admin.remove',
        message: `Removed instance admin ${t.sub}`,
        detail: { target: t },
      })
      return c.json({ ok: true })
    }),
  )

  app.put(
    '/auth/instance/permissions',
    guarded({ mutates: true, reason: true, body: { required: [] } }, async ({ c, user, body }) => {
      if (!body.sub || !body.iss || !Array.isArray(body.permissions)) {
        return c.json({ error: 'sub, iss, permissions required' }, 400)
      }
      const permissions = body.permissions as InstancePermission[]
      const t = target(body)
      const result = await setInstancePermissions(user, t, permissions)
      if (!result.ok) {
        await audit(c, user, 'session', {
          action: 'instance.permissions.update',
          status: 403,
          message: `Instance permissions update denied: ${result.error}`,
          detail: { target: t },
        })
        return c.json({ error: result.error }, 403)
      }
      await audit(c, user, 'session', {
        action: 'instance.permissions.update',
        message: `Set instance permissions for ${t.sub}`,
        detail: { target: t, permissions },
      })
      return c.json({ ok: true })
    }),
  )

  app.get(
    '/auth/instance/group-binding',
    guarded({ gate: adminOnly }, async ({ c }) => c.json(await getGroupBindingStatus())),
  )

  app.post(
    '/auth/instance/group-binding/check',
    guarded({ mutates: true, reason: true, gate: adminOnly, body: 'json' }, async ({ c, user, body }) => {
      const sample =
        body && typeof body === 'object' && Array.isArray((body as { sampleGroups?: unknown }).sampleGroups)
          ? ((body as { sampleGroups: unknown[] }).sampleGroups.filter((g): g is string => typeof g === 'string'))
          : undefined
      const status = await checkGroupBindingMode(sample)
      await audit(c, user, 'session', {
        action: 'instance.group_binding.check',
        message: status.message,
        detail: { mode: status.mode, warning: status.warning },
      })
      return c.json(status)
    }),
  )
}
