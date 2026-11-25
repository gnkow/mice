import type { Hono } from 'hono'
import { env } from '../../env.js'
import { guarded } from './routeGuard.js'
import type { AuditDep } from '../../routeDeps.js'
import { requireAuditChange } from '../../auditChange.js'
import { captureBefore } from '../../auditCapture.js'
import type { RbacAccessRequest } from '../../rbacAccessRequests.js'
import { authenticate } from './requireAuth.js'
import { isPendingUser } from '../../authz.js'
import { canSearchDirectory, searchDirectory } from '../directory/directory.js'
import { setTrainingCompleted, setTrainingCompletedSelf, hasCompletedTraining } from '../../authzInstanceStore.js'
import { rememberNotificationUser } from '../../notifications.js'
import { listCliCredentials, revokeCliCredentialFamily } from '../credentials/cliCredentials.js'
import { parseEmailLookupAuthors } from './emailLookupRequest.js'
import { currentProfilesByAuthor } from './session.js'
import {
  approveAccessRequest,
  denyAccessRequest,
  getAccessRequest,
  getOwnPendingAccessRequest,
  listAccessRequestsForReviewer,
  submitAccessRequest,
} from '../../rbacAccessRequests.js'
import { INSTANCE_PERMISSION_CATALOG, isInstancePermission } from '../../rbacCatalog.js'
import { INSTANCE_ROLES, getRolePermissions, isInstanceRole } from '../../rbacRoles.js'
import { getEffectivePermissions, getUserRole, hasPermission } from '../../rbacStore.js'
import { authzEnforceReport } from '../../authzAlwaysOn.js'
import { sessionHasMfaEvidence } from '../signing/mfaEvidence.js'
import { directoryNow } from '../directory/directory.js'
import {
  fetchDirectoryGroupsForSession,
  loadSessionGroupMembership,
} from './sessionGroupMembership.js'
import { updateCurrentSessionGroups } from './session.js'

/** Access-request state for audit deltas (null request = it does not exist yet / any more). */
function accessRequestSnapshot(
  request: RbacAccessRequest | null,
  granted?: { role: unknown; permissions: unknown },
): Record<string, unknown> | null {
  if (!request) return null
  return {
    id: request.id,
    requester: `${request.iss}|${request.sub}`,
    status: request.status,
    requested_role: request.requestedRole,
    requested_permissions: request.requestedPermissions,
    resolved_at: request.resolvedAt ?? null,
    resolved_by: request.resolvedBy ?? null,
    granted_role: granted?.role ?? null,
    granted_permissions: granted?.permissions ?? null,
  }
}

/** The caller's own identity, AuthZ summary, directory search, access requests and training. */
export function registerMeRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get('/auth/me', async (c) => {
    // Preserve 503/403 IdP denials so RequireAuth can show a gate alert (ticket 19).
    const outcome = await authenticate(c, { allowAuditorWithoutMfa: true })
    if (!outcome.ok) {
      if (outcome.status === 503 || outcome.status === 403) {
        return c.json({ authenticated: false, error: outcome.error }, outcome.status)
      }
      return c.json({ authenticated: false }, 401)
    }
    const session = outcome.user
    await rememberNotificationUser(session)
    return c.json({
      authenticated: true,
      user: {
        sub: session.sub,
        iss: session.iss,
        email: session.email,
        name: session.name,
        /** Current IdP session evidences MFA (acr + qualifying amr) — not IdP enrollment state. */
        mfaEvidenced: sessionHasMfaEvidence(session.idToken),
        /** IdP groups on this session (binding key + display name). */
        groups: await loadSessionGroupMembership(session.groups),
      },
    })
  })

  /** Effective AuthZ summary for UI (RBAC role + effective permissions). */
  app.get('/auth/me/authz', guarded({ allowAuditorWithoutMfa: true }, async ({ c, user: session }) => {
    const pending = await isPendingUser(session)
    const role = await getUserRole(session)
    const rolePermissions = Object.fromEntries(
      INSTANCE_ROLES.map((r) => [r, getRolePermissions(r)]),
    )
    return c.json({
      ...authzEnforceReport(),
      pending,
      role,
      effectivePermissions: await getEffectivePermissions(session),
      permissionCatalog: [...INSTANCE_PERMISSION_CATALOG],
      rolePermissions,
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
      change: requireAuditChange(null, accessRequestSnapshot(result.request)),
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

  app.post('/auth/access-requests/:id', guarded({
    mutates: true,
    // approve vs deny is the request's own choice; a body that names neither is refused before any Intent.
    action: ({ c, body }) =>
      body.action === 'approve'
        ? 'access-request.approve'
        : body.action === 'deny'
          ? 'access-request.deny'
          : c.json({ error: 'action required' }, 400),
    reason: true,
    body: 'json',
  }, async ({ c, user: session, body }) => {
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
      const beforeDeny = await captureBefore(() => getAccessRequest(requestId))
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
        change: requireAuditChange(accessRequestSnapshot(beforeDeny), accessRequestSnapshot(result.request)),
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
    const signedReason = (c.req.header('x-mice-reason') ?? '').trim()
    const bodyReason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const beforeApprove = await captureBefore(() => getAccessRequest(requestId))
    const result = await approveAccessRequest({
      reviewer: session,
      requestId,
      expiresAt,
      grantedRole,
      grantedPermissions,
      reason: signedReason || bodyReason || undefined,
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
      change: requireAuditChange(
        accessRequestSnapshot(beforeApprove),
        accessRequestSnapshot(result.request, {
          role: grantedRole === undefined ? result.request.requestedRole : grantedRole,
          permissions: grantedPermissions ?? result.request.requestedPermissions,
        }),
      ),
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

  app.post('/auth/training', guarded({ mutates: true, action: 'training.update', body: 'json' }, async ({ c, user: session, body: raw }) => {
    const body = raw as { sub?: string; iss?: string; completed?: boolean }
    const done = body.completed !== false
    const target = {
      sub: body.sub ?? session.sub,
      iss: body.iss ?? session.iss,
    }
    const self = target.sub === session.sub && target.iss === session.iss
    const trainingBefore = await captureBefore(() => hasCompletedTraining(target))
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
      change: requireAuditChange(
        { training_completed: trainingBefore },
        { training_completed: await hasCompletedTraining(target) },
      ),
      message: `Set training completed=${done} for ${self ? 'self' : target.sub}`,
      detail: { target, completed: done, self },
    })
    return c.json({
      ok: true,
      trainingCompleted: await hasCompletedTraining(target),
    })
  }))

  /**
   * Refresh IdP groups on this Session from the directory (Profile → Group membership).
   * Replaces session groups with the live directory list and returns display rows.
   */
  app.post('/auth/me/groups/refresh', guarded({ mutates: true, action: 'auth.session.groups.refresh' }, async ({ c, user: session, audit }) => {
    const fetched = await fetchDirectoryGroupsForSession(session, directoryNow())
    if (!fetched.ok) {
      const message =
        fetched.reason === 'unconfigured'
          ? 'Directory is not configured; group membership cannot be refreshed.'
          : 'Group membership could not be refreshed from the directory.'
      await audit({
        action: 'auth.session.groups.refresh',
        status: fetched.reason === 'unconfigured' ? 503 : 500,
        message,
        detail: { reason: fetched.reason },
      })
      return c.json({ error: message }, fetched.reason === 'unconfigured' ? 503 : 500)
    }
    const updated = await updateCurrentSessionGroups(c, fetched.bindingKeys)
    if (!updated) {
      await audit({
        action: 'auth.session.groups.refresh',
        status: 401,
        message: 'No session to update',
      })
      return c.json({ error: 'Not authenticated' }, 401)
    }
    const groups = await loadSessionGroupMembership(fetched.bindingKeys)
    await audit({
      action: 'auth.session.groups.refresh',
      change: requireAuditChange(
        { groups: [...(session.groups ?? [])].sort() },
        { groups: [...fetched.bindingKeys].sort() },
      ),
      status: 200,
      message: `Refreshed ${groups.length} IdP groups on session`,
      detail: { count: groups.length },
    })
    return c.json({ groups })
  }))

  /** List the caller's CLI credentials. */
  app.get('/auth/me/tokens', guarded({}, async ({ c, user: session }) => {
    return c.json({ tokens: await listCliCredentials(session) })
  }))

  /** Revoke one of the caller's CLI credentials. */
  app.delete('/auth/me/tokens/:id', guarded({ mutates: true, action: 'token.revoke' }, async ({ c, user: session }) => {
    const tokenId = c.req.param('id')
    const credentialBefore = (await captureBefore(() => listCliCredentials(session))).find((t) => t.id === tokenId)
    const revoked = await revokeCliCredentialFamily(session, tokenId)
    if (!revoked || !credentialBefore) return c.json({ error: 'Credential not found' }, 404)
    await auditMutation(c, session, 'session', {
      action: 'token.revoke',
      change: requireAuditChange(
        {
          id: credentialBefore.id,
          device_name: credentialBefore.deviceName ?? null,
          created_at: credentialBefore.createdAt,
          expires_at: credentialBefore.expiresAt,
        },
        null,
      ),
      message: `Revoked CLI credential ${tokenId}`,
      detail: { tokenId },
    })
    return c.json({ ok: true })
  }))

  /** Current emails (and names) for commit authors. The oxen commit is left unchanged. */
  app.post('/auth/principals/emails', guarded({ body: 'json' }, async ({ c, body }) => {
    return c.json(await currentProfilesByAuthor(parseEmailLookupAuthors(body)))
  }))
}
