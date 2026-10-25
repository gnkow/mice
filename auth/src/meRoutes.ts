import type { Hono } from 'hono'
import { env } from './env.js'
import { guarded } from './routeGuard.js'
import type { AuditDep } from './routeDeps.js'
import { authenticateUser } from './requireAuth.js'
import { canReviewAccessRequests, listAccessRequests, resolveAccessRequest, submitAccessRequest } from './accessRequests.js'
import { decideInstanceAction, isPendingUser } from './authz.js'
import { canSearchDirectory, searchDirectory } from './directory.js'
import { hasInstancePermission, isAuthzEnforce, isInstanceAdmin, setTrainingCompleted, setTrainingCompletedSelf, hasCompletedTraining } from './authzInstanceStore.js'
import { namespacesWithCapability } from './authzMembershipStore.js'
import { userHasAnyGrant } from './authzVisibility.js'
import { ALL_INSTANCE_PERMISSIONS, type InstancePermission, type MemberRoleRef } from './authzTypes.js'
import { rememberNotificationUser } from './notifications.js'

/** The caller's own identity, AuthZ summary, directory search, access requests and training. */
export function registerMeRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get('/auth/me', async (c) => {
    const session = await authenticateUser(c)
    if (!session) return c.json({ authenticated: false }, 401)
    rememberNotificationUser(session)
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

  /** Effective AuthZ summary for UI (pending gate, instance flags). */
  app.get('/auth/me/authz', guarded({}, async ({ c, user: session }) => {
    const pending = isPendingUser(session)
    return c.json({
      enforce: isAuthzEnforce(),
      pending,
      instanceAdmin: isInstanceAdmin(session),
      permissions: Object.fromEntries(
        ALL_INSTANCE_PERMISSIONS.map((p) => [
          p,
          hasInstancePermission(session, p),
        ]),
      ) as Record<(typeof ALL_INSTANCE_PERMISSIONS)[number], boolean>,
      instancePermissionCatalog: ALL_INSTANCE_PERMISSIONS,
      hasAnyGrant: userHasAnyGrant(session),
      trainingCompleted: hasCompletedTraining(session),
      requireTraining: env.authzRequireTraining,
    })
  }))

  /** IdP / store directory search for AuthZ member & collaborator pickers. */
  app.get('/auth/directory/search', guarded({ gate: (u) => (canSearchDirectory(u) ? null : 'Forbidden') }, async ({ c }) => {
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
    const message = (body.message as string | undefined) ?? ''
    const req = submitAccessRequest(session, message)
    auditMutation(c, session, 'session', {
      action: 'access-request.submit',
      message: 'Submitted access request',
      detail: { requestId: req.id },
    })
    return c.json({ ok: true, request: req })
  }))

  app.get('/auth/access-requests', guarded({ gate: (u) => (canReviewAccessRequests(u) ? null : 'Forbidden') }, async ({ c, user: session }) => {
    const fullHistory = decideInstanceAction(session, 'access.review.all').allow
    return c.json({
      requests: listAccessRequests({ pendingOnly: !fullHistory }),
      reviewNamespaces: namespacesWithCapability(
        session,
        'review_access_requests',
      ),
    })
  }))

  app.post('/auth/access-requests/:id', guarded({ mutates: true, reason: true, body: 'json' }, async ({ c, user: session, body: raw }) => {
    const body = raw as {
      action?: 'approve' | 'deny'
      namespace?: string
      role?: MemberRoleRef
      permission?: InstancePermission
    }
    if (body.action !== 'approve' && body.action !== 'deny') {
      return c.json({ error: 'action required' }, 400)
    }
    const result = resolveAccessRequest(session, c.req.param('id'), body.action, {
      namespace: body.namespace,
      role: body.role,
      permission: body.permission,
    })
    if (!result.ok) {
      auditMutation(c, session, 'session', {
        action: `access-request.${body.action}`,
        status: 400,
        message: `Access request ${body.action} failed: ${result.error}`,
        detail: { requestId: c.req.param('id') },
      })
      return c.json({ error: result.error }, 400)
    }
    auditMutation(c, session, 'session', {
      action: `access-request.${body.action}`,
      namespace: body.action === 'approve' ? body.namespace : undefined,
      message: `Access request ${result.request.status}`,
      detail: {
        requestId: result.request.id,
        requester: { sub: result.request.sub, iss: result.request.iss },
        ...(body.action === 'approve'
          ? { role: body.role, permission: body.permission }
          : {}),
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
      setTrainingCompletedSelf(session, done)
    } else {
      const result = setTrainingCompleted(session, target, done)
      if (!result.ok) {
        auditMutation(c, session, 'session', {
          action: 'training.update',
          status: 403,
          message: `Training update denied: ${result.error}`,
          detail: { target, completed: done },
        })
        return c.json({ error: result.error }, 403)
      }
    }
    auditMutation(c, session, 'session', {
      action: 'training.update',
      message: `Set training completed=${done} for ${self ? 'self' : target.sub}`,
      detail: { target, completed: done, self },
    })
    return c.json({
      ok: true,
      trainingCompleted: hasCompletedTraining(target),
    })
  }))
}
