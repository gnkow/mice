import type { Hono } from 'hono'
import { env } from '../../env.js'
import { guarded } from './routeGuard.js'
import type { AuditDep } from '../../routeDeps.js'
import { authenticateUser } from './requireAuth.js'
import { isPendingUser } from '../../authz.js'
import { canSearchDirectory, searchDirectory } from '../directory/directory.js'
import { setTrainingCompleted, setTrainingCompletedSelf, hasCompletedTraining } from '../../authzInstanceStore.js'
import { rememberNotificationUser } from '../../notifications.js'
import { listCliCredentials, revokeCliCredentialFamily } from '../credentials/cliCredentials.js'
import { parseEmailLookupAuthors } from './emailLookupRequest.js'
import { currentEmailsByAuthor } from './session.js'
import {
  approveAccessRequest,
  denyAccessRequest,
  getOwnPendingAccessRequest,
  listAccessRequestsForReviewer,
  submitAccessRequest,
} from '../../rbacAccessRequests.js'
import { INSTANCE_PERMISSION_CATALOG, isInstancePermission } from '../../rbacCatalog.js'
import { isInstanceRole } from '../../rbacRoles.js'
import { getEffectivePermissions, getUserRole, hasPermission } from '../../rbacStore.js'

/** The caller's own identity, AuthZ summary, directory search, access requests and training. */
export function registerMeRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get('/auth/me', async (c) => {
    const session = await authenticateUser(c, { allowAuditorWithoutMfa: true })
    if (!session) return c.json({ authenticated: false }, 401)
    await rememberNotificationUser(session)
    return c.json({
      authenticated: true,
      user: {
        sub: session.sub,
        iss: session.iss,
        email: session.email,
        name: session.name,
      },
    })
  })

  /** Effective AuthZ summary for UI (RBAC role + effective permissions). */
  app.get('/auth/me/authz', guarded({}, async ({ c, user: session }) => {
    const pending = await isPendingUser(session)
    const role = await getUserRole(session)
    return c.json({
      enforce: true,
      pending,
      role,
      effectivePermissions: await getEffectivePermissions(session),
      permissionCatalog: [...INSTANCE_PERMISSION_CATALOG],
      trainingCompleted: await hasCompletedTraining(session),
      requireTraining: env.authzRequireTraining,
    })
  }))

  /** Caller's own pending access request (Profile → Permissions). */
  app.get('/auth/me/access-request', guarded({}, async ({ c, user: session }) => {
    return c.json({ request: await getOwnPendingAccessRequest(session) })
  }))

  /** IdP / store directory search for AuthZ member & collaborator pickers. */
  app.get('/auth/directory/search', guarded({ gate: async (u) => (await canSearchDirectory(u) ? null : 'Forbidden') }, async ({ c }) => {
    const q = c.req.query('q') ?? ''
    const kindRaw = (c.req.query('kind') ?? 'user').toLowerCase()
    const kind = kindRaw === 'group' ? 'group' : 'user'
    const limitRaw = Number(c.req.query('limit') ?? 25)
    const result = await searchDirectory({
      q,
      kind,
      limit: Number.isFinite(limitRaw) ? limitRaw : 25,
    })
    return c.json(result)
  }))

  app.post('/auth/access-requests', guarded({ body: 'optional' }, async ({ c, user: session, body }) => {
    const message = typeof body.message === 'string' ? body.message : ''
    const requestedRole =
      body.requestedRole === null || body.requestedRole === undefined
        ? null
        : typeof body.requestedRole === 'string' && isInstanceRole(body.requestedRole)
          ? body.requestedRole
          : undefined
    if (body.requestedRole !== undefined && body.requestedRole !== null && requestedRole === undefined) {
      return c.json({ error: `Invalid role: ${String(body.requestedRole)}` }, 400)
    }
    const rawPerms = Array.isArray(body.requestedPermissions) ? body.requestedPermissions : []
    const requestedPermissions: string[] = []
    for (const p of rawPerms) {
      if (typeof p !== 'string' || !isInstancePermission(p)) {
        return c.json({ error: `Invalid permission: ${String(p)}` }, 400)
      }
      requestedPermissions.push(p)
    }
    const result = await submitAccessRequest({
      user: session,
      message,
      requestedRole,
      requestedPermissions,
    })
    if (!result.ok) {
      await auditMutation(c, session, 'session', {
        action: 'access-request.submit',
        status: 400,
        message: `Access request submit failed: ${result.error}`,
      })
      return c.json({ error: result.error }, 400)
    }
    await auditMutation(c, session, 'session', {
      action: 'access-request.submit',
      message: 'Submitted access request',
      detail: {
        requestId: result.request.id,
        requestedRole: result.request.requestedRole,
        requestedPermissions: result.request.requestedPermissions,
      },
    })
    return c.json({ ok: true, request: result.request })
  }))

  app.get(
    '/auth/access-requests',
    guarded({
      gate: async (u) => ((await hasPermission(u, 'access_request:list')) ? null : 'Forbidden'),
    }, async ({ c, user: session }) => {
      // Admins see resolved history; managers see pending they can act on.
      const pendingOnly = (await getUserRole(session)) !== 'admin'
      return c.json({
        requests: await listAccessRequestsForReviewer(session, { pendingOnly }),
      })
    }),
  )

  app.post('/auth/access-requests/:id', guarded({ mutates: true, reason: true, body: 'json' }, async ({ c, user: session, body }) => {
    if (!(await hasPermission(session, 'access_request:review'))) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const action = body.action
    if (action !== 'approve' && action !== 'deny') {
      return c.json({ error: 'action required' }, 400)
    }
    const requestId = c.req.param('id')

    if (action === 'deny') {
      const reason = typeof body.reason === 'string' ? body.reason : ''
      if (!reason.trim()) return c.json({ error: 'Denial reason is required' }, 400)
      const result = await denyAccessRequest({ reviewer: session, requestId, reason })
      if (!result.ok) {
        const status = result.error === 'Not found' ? 404 : result.error.startsWith('Forbidden') ? 403 : 400
        await auditMutation(c, session, 'session', {
          action: 'access-request.deny',
          status,
          message: `Access request deny failed: ${result.error}`,
          detail: { requestId },
        })
        return c.json({ error: result.error }, status)
      }
      await auditMutation(c, session, 'session', {
        action: 'access-request.deny',
        message: 'Access request denied',
        detail: {
          requestId: result.request.id,
          requester: { sub: result.request.sub, iss: result.request.iss },
          reason,
        },
      })
      return c.json({ ok: true, request: result.request })
    }

    const expiresAt = body.expiresAt
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
      return c.json({ error: 'expiresAt is required for approval' }, 400)
    }
    const grantedRole =
      body.grantedRole === undefined
        ? undefined
        : body.grantedRole === null
          ? null
          : typeof body.grantedRole === 'string' && isInstanceRole(body.grantedRole)
            ? body.grantedRole
            : undefined
    if (body.grantedRole !== undefined && body.grantedRole !== null && grantedRole === undefined) {
      return c.json({ error: `Invalid role: ${String(body.grantedRole)}` }, 400)
    }
    let grantedPermissions: string[] | undefined
    if (body.grantedPermissions !== undefined) {
      if (!Array.isArray(body.grantedPermissions)) {
        return c.json({ error: 'grantedPermissions must be an array' }, 400)
      }
      grantedPermissions = []
      for (const p of body.grantedPermissions) {
        if (typeof p !== 'string' || !isInstancePermission(p)) {
          return c.json({ error: `Invalid permission: ${String(p)}` }, 400)
        }
        grantedPermissions.push(p)
      }
    }
    const result = await approveAccessRequest({
      reviewer: session,
      requestId,
      expiresAt,
      grantedRole,
      grantedPermissions,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    })
    if (!result.ok) {
      const status = result.error === 'Not found' ? 404 : result.error.startsWith('Forbidden') ? 403 : 400
      await auditMutation(c, session, 'session', {
        action: 'access-request.approve',
        status,
        message: `Access request approve failed: ${result.error}`,
        detail: { requestId },
      })
      return c.json({ error: result.error }, status)
    }
    await auditMutation(c, session, 'session', {
      action: 'access-request.approve',
      message: 'Access request approved',
      detail: {
        requestId: result.request.id,
        requester: { sub: result.request.sub, iss: result.request.iss },
        grantedRole: body.grantedRole,
        grantedPermissions: body.grantedPermissions,
      },
    })
    return c.json({ ok: true, request: result.request })
  }))

  app.post('/auth/training', guarded({ mutates: true, body: 'json' }, async ({ c, user: session, body: raw }) => {
    const body = raw as { sub?: string; iss?: string; completed?: boolean }
    const done = body.completed !== false
    const target = {
      sub: body.sub ?? session.sub,
      iss: body.iss ?? session.iss,
    }
    const self = target.sub === session.sub && target.iss === session.iss
    if (self) {
      await setTrainingCompletedSelf(session, done)
    } else {
      const result = await setTrainingCompleted(session, target, done)
      if (!result.ok) {
        await auditMutation(c, session, 'session', {
          action: 'training.update',
          status: 403,
          message: `Training update denied: ${result.error}`,
          detail: { target, completed: done },
        })
        return c.json({ error: result.error }, 403)
      }
    }
    await auditMutation(c, session, 'session', {
      action: 'training.update',
      message: `Set training completed=${done} for ${self ? 'self' : target.sub}`,
      detail: { target, completed: done, self },
    })
    return c.json({
      ok: true,
      trainingCompleted: await hasCompletedTraining(target),
    })
  }))

  /** List the caller's CLI credentials. */
  app.get('/auth/me/tokens', guarded({}, async ({ c, user: session }) => {
    return c.json({ tokens: await listCliCredentials(session) })
  }))

  /** Revoke one of the caller's CLI credentials. */
  app.delete('/auth/me/tokens/:id', guarded({ mutates: true }, async ({ c, user: session }) => {
    const tokenId = c.req.param('id')
    const revoked = await revokeCliCredentialFamily(session, tokenId)
    if (!revoked) return c.json({ error: 'Credential not found' }, 404)
    await auditMutation(c, session, 'session', {
      action: 'token.revoke',
      message: `Revoked CLI credential ${tokenId}`,
      detail: { tokenId },
    })
    return c.json({ ok: true })
  }))

  /** Current emails for commit authors. The oxen commit is left unchanged. */
  app.post('/auth/principals/emails', guarded({ body: 'json' }, async ({ c, body }) => {
    return c.json({ emails: await currentEmailsByAuthor(parseEmailLookupAuthors(body)) })
  }))
}
