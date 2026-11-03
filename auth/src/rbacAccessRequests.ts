import { randomBytes } from 'node:crypto'
import { getDb } from './db/database.js'
import { accessRequests } from './db/schema.js'
import { isInstancePermission, type InstancePermission } from './rbacCatalog.js'
import { isInstanceRole, type InstanceRole } from './rbacRoles.js'
import { canonicalIssuer } from './authentication/session/principal.js'

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
    .onConflictDoNothing()
    .returning()

  if (!created) {
    return { ok: false, error: 'A pending access request already exists' }
  }
  return { ok: true, request: toRequest(created) }
}
