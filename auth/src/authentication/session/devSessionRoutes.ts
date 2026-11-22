/**
 * Dev-only session mint for Playwright e2e.
 * Registered only when AUTH_DEV_MODE=true (forbidden in production by startupGate).
 */
import type { Hono } from 'hono'
import { env } from '../../env.js'
import { isInstanceRole, type InstanceRole } from '../../rbacRoles.js'
import { assignRole } from '../../rbacStore.js'
import { prepareMutationDocument } from '../../mutationSignature.js'
import { signatureStore } from '../signing/signatureStore.js'
import { sealSessionCookie } from './cookieSeal.js'
import { getSession, sealSession, type SessionUser } from './session.js'

const ROLES: InstanceRole[] = ['external', 'user', 'manager', 'auditor', 'admin']

function devMfaIdToken(): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return [part({ alg: 'none' }), part({ acr: 'mfa', amr: ['pwd', 'otp'] }), 'dev'].join('.')
}

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
    // `none` mints a signed-in user without a formal role (the access-request path).
    if (roleRaw !== 'none' && !isInstanceRole(roleRaw)) {
      return c.json({ error: `Invalid role (want one of none, ${ROLES.join(', ')})` }, 400)
    }
    const role = roleRaw

    const user: SessionUser = {
      sub,
      iss,
      email,
      name,
      emailVerified: body.emailVerified !== false,
      ...(groups.length ? { groups } : {}),
      // Lets e2e exercise MFA-gated roles (Auditor); the claims are unsigned test data.
      ...(body.mfa === true ? { idToken: devMfaIdToken() } : {}),
    }

    const id = await sealSession(user)
    const sealed = await sealSessionCookie(id)

    if (role !== 'none') {
      const granted = await assignRole({
        actor: null,
        target: user,
        role,
        reason: 'auth-dev-mode e2e mint',
        bootstrap: true,
      })
      if (!granted.ok) return c.json({ error: granted.error }, 400)
    }

    return c.json({
      cookieName: env.cookieName,
      cookieValue: sealed,
      user: { sub, iss, email, name, role },
    })
  })

  /**
   * Mint a one-shot mutation signature for e2e regulated calls (same shape as unit
   * `regulatedMutationHeaders`). Real ceremony remains the production path.
   */
  app.post('/auth/dev/mutation-signature', async (c) => {
    const session = await getSession(c)
    if (!session) return c.json({ error: 'Unauthorized' }, 401)
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const method = typeof body.method === 'string' ? body.method : ''
    const path = typeof body.path === 'string' ? body.path : ''
    const reason = typeof body.reason === 'string' ? body.reason : ''
    if (!method || !path || !reason) {
      return c.json({ error: 'method, path, and reason are required' }, 400)
    }
    const prepared = prepareMutationDocument({
      method,
      path,
      reason,
      body: body.body ?? {},
    })
    const { id } = await (
      await signatureStore()
    ).record({
      signer: {
        iss: session.iss,
        sub: session.sub,
        name: session.name ?? `${session.iss}|${session.sub}`,
      },
      meaning: 'Approved',
      contentHash: prepared.hash,
    })
    return c.json({
      signatureId: id,
      reason,
      hash: prepared.hash,
    })
  })
}
