import { randomBytes } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { accessRequests } from './db/schema.js'
import { canApproveModifiedGrant, canApproveRole, canGrantPermissions } from './rbacAuthority.js'
import { isInstancePermission, type InstancePermission } from './rbacCatalog.js'
import { isInstanceRole, type InstanceRole } from './rbacRoles.js'
import {
  assignRole,
  getEffectivePermissions,
  getUserRole,
  grantCustomPermissions,
} from './rbacStore.js'
import { canonicalIssuer } from './authentication/session/principal.js'
import { userKey } from './authzTypes.js'

type UserRef = { sub: string; iss: string; email?: string; name?: string }

export type RbacAccessRequest = {
  id: string
  sub: string
  iss: string
  email: string
  name: string
  message: string
  createdAt: string
  status: 'pending' | 'approved' | 'denied'
  requestedRole: InstanceRole | null
  requestedPermissions: InstancePermission[]
  resolvedAt?: string
  resolvedBy?: string
}

type Result =
  | { ok: true; request: RbacAccessRequest }
  | { ok: false; error: string }

function toRequest(r: typeof accessRequests.$inferSelect): RbacAccessRequest {
  return {
    id: r.id,
    sub: r.sub,
    iss: r.iss,
    email: r.email,
    name: r.name,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    status: r.status as RbacAccessRequest['status'],
    requestedRole: r.requestedRole && isInstanceRole(r.requestedRole) ? r.requestedRole : null,
    requestedPermissions: (r.requestedPermissions ?? []).filter(isInstancePermission),
    ...(r.resolvedAt ? { resolvedAt: r.resolvedAt.toISOString() } : {}),
    ...(r.resolvedBy ? { resolvedBy: r.resolvedBy } : {}),
  }
}

export async function submitAccessRequest(input: {
  user: UserRef
  message: string
  requestedRole?: InstanceRole | null
  requestedPermissions?: readonly string[]
}): Promise<Result> {
  const message = input.message.trim().slice(0, 500)
  if (!message) {
    return { ok: false, error: 'Justification message is required' }
  }

  const role = input.requestedRole ?? null
  if (role != null && !isInstanceRole(role)) {
    return { ok: false, error: `Invalid role: ${String(role)}` }
  }

  const perms: InstancePermission[] = []
  for (const p of input.requestedPermissions ?? []) {
    if (!isInstancePermission(p)) {
      return { ok: false, error: `Invalid permission: ${p}` }
    }
    if (!perms.includes(p)) perms.push(p)
  }

  if (role == null && perms.length === 0) {
    return { ok: false, error: 'Request must include a role or custom permissions' }
  }

  const iss = canonicalIssuer(input.user.iss)
  const requestType = role != null && perms.length === 0
    ? 'initial'
    : role != null
      ? 'upgrade'
      : 'additional'

  const existing = await getOwnPendingAccessRequest(input.user)
  if (existing) {
    // One pending per user: a new submit replaces the previous pending request in place.
    const [updated] = await getDb()
      .update(accessRequests)
      .set({
        email: input.user.email ?? existing.email,
        name: input.user.name ?? existing.name,
        message,
        createdAt: new Date(),
        requestedRole: role,
        requestedPermissions: perms,
        requestType,
      })
      .where(
        and(
          eq(accessRequests.id, existing.id),
          eq(accessRequests.status, 'pending'),
        ),
      )
      .returning()
    if (!updated) {
      return { ok: false, error: 'Could not replace pending access request' }
    }
    return { ok: true, request: toRequest(updated) }
  }

  const [created] = await getDb()
    .insert(accessRequests)
    .values({
      id: randomBytes(8).toString('hex'),
      sub: input.user.sub,
      iss,
      email: input.user.email ?? '',
      name: input.user.name ?? '',
      message,
      createdAt: new Date(),
      status: 'pending',
      requestedRole: role,
      requestedPermissions: perms,
      requestType,
    })
    .returning()

  if (!created) {
    return { ok: false, error: 'Could not create access request' }
  }
  return { ok: true, request: toRequest(created) }
}

/** Caller's own pending access request, or null. */
export async function getOwnPendingAccessRequest(
  user: UserRef,
): Promise<RbacAccessRequest | null> {
  const iss = canonicalIssuer(user.iss)
  const [row] = await getDb()
    .select()
    .from(accessRequests)
    .where(
      and(
        eq(accessRequests.sub, user.sub),
        eq(accessRequests.iss, iss),
        eq(accessRequests.status, 'pending'),
      ),
    )
    .limit(1)
  return row ? toRequest(row) : null
}

export async function listAccessRequestsForReviewer(
  reviewer: UserRef,
  opts?: { pendingOnly?: boolean },
): Promise<RbacAccessRequest[]> {
  const reviewerRole = await getUserRole(reviewer)
  if (!reviewerRole) return []
  const reviewerPerms = await getEffectivePermissions(reviewer)
  const pendingOnly = opts?.pendingOnly !== false
  const rows = await getDb()
    .select()
    .from(accessRequests)
    .where(pendingOnly ? eq(accessRequests.status, 'pending') : undefined)
    .orderBy(desc(accessRequests.createdAt))

  return rows.map(toRequest).filter((req) => {
    if (req.requestedRole) {
      if (!canApproveRole(reviewerRole, req.requestedRole)) return false
    }
    if (req.requestedPermissions.length > 0) {
      if (!canGrantPermissions(reviewerPerms, req.requestedPermissions)) return false
    }
    // Role-only or perms-only or both already checked; empty both cannot exist.
    return req.requestedRole != null || req.requestedPermissions.length > 0
  })
}

export async function approveAccessRequest(input: {
  reviewer: UserRef
  requestId: string
  expiresAt: Date | number
  grantedRole?: InstanceRole | null
  grantedPermissions?: readonly string[]
  reason?: string
}): Promise<Result> {
  const reviewerRole = await getUserRole(input.reviewer)
  if (!reviewerRole) return { ok: false, error: 'Forbidden: no reviewer role' }
  const reviewerPerms = await getEffectivePermissions(input.reviewer)

  const [found] = await getDb()
    .select()
    .from(accessRequests)
    .where(eq(accessRequests.id, input.requestId))
    .limit(1)
  if (!found) return { ok: false, error: 'Not found' }
  if (found.status !== 'pending') return { ok: false, error: 'Already resolved' }
  const req = toRequest(found)

  const grantedRole = input.grantedRole !== undefined ? input.grantedRole : req.requestedRole
  const grantedPermissions = [...(input.grantedPermissions ?? req.requestedPermissions)]

  if (
    !canApproveModifiedGrant({
      reviewerRole,
      reviewerEffective: reviewerPerms,
      grantedRole,
      grantedPermissions,
    })
  ) {
    return { ok: false, error: 'Forbidden: insufficient approval authority' }
  }

  const target = { sub: req.sub, iss: req.iss }
  const reason = input.reason?.trim() || `Approved access request ${req.id}`

  if (grantedRole) {
    const roleResult = await assignRole({
      actor: input.reviewer,
      target,
      role: grantedRole,
      reason,
      expiresAt: input.expiresAt,
      accessRequestId: req.id,
    })
    if (!roleResult.ok) return roleResult
  }
  if (grantedPermissions.length > 0) {
    const permResult = await grantCustomPermissions({
      actor: input.reviewer,
      target,
      permissions: grantedPermissions,
      reason,
      expiresAt: input.expiresAt,
      accessRequestId: req.id,
    })
    if (!permResult.ok) return permResult
  }

  const [updated] = await getDb()
    .update(accessRequests)
    .set({
      status: 'approved',
      resolvedAt: new Date(),
      resolvedBy: userKey(input.reviewer),
      approvalReason: input.reason?.trim() || null,
      grantedRole,
      grantedPermissions,
    })
    .where(and(eq(accessRequests.id, input.requestId), eq(accessRequests.status, 'pending')))
    .returning()

  if (!updated) return { ok: false, error: 'Already resolved' }
  return { ok: true, request: toRequest(updated) }
}

export async function denyAccessRequest(input: {
  reviewer: UserRef
  requestId: string
  reason: string
}): Promise<Result> {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, error: 'Denial reason is required' }

  const reviewerRole = await getUserRole(input.reviewer)
  if (!reviewerRole || (reviewerRole !== 'manager' && reviewerRole !== 'admin')) {
    return { ok: false, error: 'Forbidden' }
  }

  const [found] = await getDb()
    .select()
    .from(accessRequests)
    .where(eq(accessRequests.id, input.requestId))
    .limit(1)
  if (!found) return { ok: false, error: 'Not found' }
  if (found.status !== 'pending') return { ok: false, error: 'Already resolved' }

  // Reviewer must have authority over the requested role (or be admin for perms-only).
  const req = toRequest(found)
  if (req.requestedRole && !canApproveRole(reviewerRole, req.requestedRole)) {
    return { ok: false, error: 'Forbidden: insufficient approval authority' }
  }

  const [updated] = await getDb()
    .update(accessRequests)
    .set({
      status: 'denied',
      resolvedAt: new Date(),
      resolvedBy: userKey(input.reviewer),
      approvalReason: reason,
    })
    .where(and(eq(accessRequests.id, input.requestId), eq(accessRequests.status, 'pending')))
    .returning()

  if (!updated) return { ok: false, error: 'Already resolved' }
  return { ok: true, request: toRequest(updated) }
}
