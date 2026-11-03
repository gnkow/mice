/**
 * Dev-only session mint for Playwright e2e.
 * Registered only when AUTH_DEV_MODE=true (forbidden in production by startupGate).
 */
import type { Hono } from 'hono'
import { env } from '../../env.js'
import { addAdminKey } from '../../authzRepository.js'
import { userKey } from '../../authzTypes.js'
import { isInstanceRole, type InstanceRole } from '../../rbacRoles.js'
import { assignRole } from '../../rbacStore.js'
import { sealSessionCookie } from './cookieSeal.js'
import { sealSession, type SessionUser } from './session.js'

const ROLES: InstanceRole[] = ['external', 'user', 'manager', 'auditor', 'admin']

export function registerDevSessionRoutes(app: Hono): void {
  if (!env.authDevMode) return

  app.post('/auth/dev/session', async (c) => {
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const sub = typeof body.sub === 'string' ? body.sub.trim() : ''
    const iss = typeof body.iss === 'string' ? body.iss.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!sub || !iss || !email || !name) {
      return c.json({ error: 'sub, iss, email, and name are required' }, 400)
    }

    const groups = Array.isArray(body.groups)
      ? body.groups.filter((g): g is string => typeof g === 'string').map((g) => g.trim().toLowerCase()).filter(Boolean)
      : []

    const roleRaw = typeof body.role === 'string' ? body.role.trim().toLowerCase() : 'admin'
    if (!isInstanceRole(roleRaw)) {
      return c.json({ error: `Invalid role (want one of ${ROLES.join(', ')})` }, 400)
    }
    const role = roleRaw
    const instanceAdmin = body.instanceAdmin === true || role === 'admin'

    const user: SessionUser = {
      sub,
      iss,
      email,
      name,
      emailVerified: body.emailVerified !== false,
      ...(groups.length ? { groups } : {}),
    }

    const id = await sealSession(user)
    const sealed = await sealSessionCookie(id)

    const granted = await assignRole({
      actor: null,
      target: user,
      role,
      reason: 'auth-dev-mode e2e mint',
      bootstrap: true,
    })
    if (!granted.ok) return c.json({ error: granted.error }, 400)

    if (instanceAdmin) await addAdminKey(userKey(user))

    return c.json({
      cookieName: env.cookieName,
      cookieValue: sealed,
      user: { sub, iss, email, name, role, instanceAdmin },
    })
  })
}
