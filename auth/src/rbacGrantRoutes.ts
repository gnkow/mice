import type { Hono } from 'hono'
import { guarded } from './authentication/session/routeGuard.js'
import type { AuditDep } from './routeDeps.js'
import { directGrantPermissions, directGrantRole } from './rbacDirectGrant.js'
import { isInstancePermission } from './rbacCatalog.js'
import { isInstanceRole } from './rbacRoles.js'
import { getUserRole } from './rbacStore.js'

function target(body: Record<string, unknown>): { sub: string; iss: string } | null {
  if (typeof body.sub !== 'string' || typeof body.iss !== 'string') return null
  return { sub: body.sub, iss: body.iss }
}

function parseExpiresAt(body: Record<string, unknown>): number | null {
  if (typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt)) return body.expiresAt
  if (typeof body.expiresAt === 'string') {
    const n = Date.parse(body.expiresAt)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function grantReason(body: Record<string, unknown>): string {
  return typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Direct grant'
}

/** Direct role and custom-permission grants (Settings → Grant Access). */
export function registerRbacGrantRoutes(app: Hono, { audit }: AuditDep): void {
  const reviewerOnly = async (u: { sub: string; iss: string }) => {
    const role = await getUserRole(u)
    return role === 'manager' || role === 'admin' ? null : 'Forbidden'
  }

  app.post(
    '/auth/grants/role',
    guarded(
      { mutates: true, reason: true, gate: reviewerOnly, body: { required: ['sub', 'iss', 'role'] } },
      async ({ c, user, body }) => {
        const t = target(body)
        if (!t) return c.json({ error: 'sub and iss required' }, 400)
        if (!isInstanceRole(body.role)) {
          return c.json({ error: `Invalid role: ${String(body.role)}` }, 400)
        }
        const expiresAt = parseExpiresAt(body)
        if (expiresAt == null) {
          return c.json({ error: 'expiresAt is required for delegated role grants' }, 400)
        }
        const result = await directGrantRole({
          actor: user,
          target: t,
          role: body.role,
          reason: grantReason(body),
          expiresAt,
        })
        if (!result.ok) {
          const status = result.error.startsWith('Forbidden') ? 403 : 400
          await audit(c, user, 'session', {
            action: 'access.grant.role',
            status,
            message: `Direct role grant denied: ${result.error}`,
            detail: { target: t, role: body.role },
          })
          return c.json({ error: result.error }, status)
        }
        await audit(c, user, 'session', {
          action: 'access.grant.role',
          message: `Granted role ${body.role} to ${t.sub}`,
          detail: { target: t, role: body.role, expiresAt },
        })
        return c.json({ ok: true })
      },
    ),
  )

  app.post(
    '/auth/grants/permissions',
    guarded(
      {
        mutates: true,
        reason: true,
        gate: reviewerOnly,
        body: { required: ['sub', 'iss', 'permissions'] },
      },
      async ({ c, user, body }) => {
        const t = target(body)
        if (!t) return c.json({ error: 'sub and iss required' }, 400)
        if (!Array.isArray(body.permissions)) {
          return c.json({ error: 'permissions must be an array' }, 400)
        }
        const permissions: string[] = []
        for (const p of body.permissions) {
          if (typeof p !== 'string' || !isInstancePermission(p)) {
            return c.json({ error: `Invalid permission: ${String(p)}` }, 400)
          }
          permissions.push(p)
        }
        const expiresAt = parseExpiresAt(body)
        if (expiresAt == null) {
          return c.json({ error: 'expiresAt is required for delegated permission grants' }, 400)
        }
        const result = await directGrantPermissions({
          actor: user,
          target: t,
          permissions,
          reason: grantReason(body),
          expiresAt,
        })
        if (!result.ok) {
          const status = result.error.startsWith('Forbidden') ? 403 : 400
          await audit(c, user, 'session', {
            action: 'access.grant.permissions',
            status,
            message: `Direct permission grant denied: ${result.error}`,
            detail: { target: t, permissions },
          })
          return c.json({ error: result.error }, status)
        }
        await audit(c, user, 'session', {
          action: 'access.grant.permissions',
          message: `Granted permissions to ${t.sub}`,
          detail: { target: t, permissions, expiresAt },
        })
        return c.json({ ok: true })
      },
    ),
  )
}
