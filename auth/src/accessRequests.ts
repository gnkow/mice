import { randomBytes } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { accessRequests } from './db/schema.js'
import type { SessionUser } from './authentication/session/session.js'
import {
  userKey,
  type InstancePermission,
  type MemberRoleRef,
} from './authzTypes.js'
import { decideAccessReview, decideInstanceAction, decideNamespaceAction } from './authz.js'
import { instancePermissions, setInstancePermissions } from './authzInstanceStore.js'
import { setNamespaceMember } from './authzMembershipStore.js'

export type AccessRequest = {
  id: string
  sub: string
  iss: string
  email: string
  name: string
  message: string
  createdAt: string
  status: 'pending' | 'approved' | 'denied'
  resolvedAt?: string
  resolvedBy?: string
}

type Row = typeof accessRequests.$inferSelect

function toRequest(r: Row): AccessRequest {
  return {
    id: r.id, sub: r.sub, iss: r.iss, email: r.email, name: r.name, message: r.message,
    createdAt: r.createdAt.toISOString(),
    status: r.status as AccessRequest['status'],
    ...(r.resolvedAt ? { resolvedAt: r.resolvedAt.toISOString() } : {}),
    ...(r.resolvedBy ? { resolvedBy: r.resolvedBy } : {}),
  }
}

export async function listAccessRequests(opts?: {
  pendingOnly?: boolean
}): Promise<AccessRequest[]> {
  const rows = await getDb().select().from(accessRequests)
    .where(opts?.pendingOnly ? eq(accessRequests.status, 'pending') : undefined)
    .orderBy(desc(accessRequests.createdAt))
  return rows.map(toRequest)
}

export async function canReviewAccessRequests(actor: SessionUser): Promise<boolean> {
  return (await decideAccessReview(actor)).allow
}

export async function submitAccessRequest(
  user: SessionUser,
  message: string,
): Promise<AccessRequest> {
  const db = getDb()
  const [created] = await db.insert(accessRequests).values({
    id: randomBytes(8).toString('hex'),
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
    message: message.trim().slice(0, 500),
    createdAt: new Date(),
    status: 'pending',
  }).onConflictDoNothing().returning()
  if (created) return toRequest(created)
  const [existing] = await db.select().from(accessRequests).where(and(
    eq(accessRequests.sub, user.sub), eq(accessRequests.iss, user.iss), eq(accessRequests.status, 'pending'),
  ))
  return toRequest(existing)
}

/** The conditional update makes resolution single-winner under concurrent reviewers. */
async function markResolved(id: string, status: 'approved' | 'denied', actor: SessionUser): Promise<AccessRequest | null> {
  const [row] = await getDb().update(accessRequests)
    .set({ status, resolvedAt: new Date(), resolvedBy: userKey(actor) })
    .where(and(eq(accessRequests.id, id), eq(accessRequests.status, 'pending')))
    .returning()
  return row ? toRequest(row) : null
}

export async function resolveAccessRequest(
  actor: SessionUser,
  id: string,
  action: 'approve' | 'deny',
  grant?: {
    namespace?: string
    role?: MemberRoleRef
    permission?: InstancePermission
  },
): Promise<{ ok: true; request: AccessRequest } | { ok: false; error: string }> {
  const [found] = await getDb().select().from(accessRequests).where(eq(accessRequests.id, id))
  if (!found) return { ok: false, error: 'Not found' }
  if (found.status !== 'pending') return { ok: false, error: 'Already resolved' }
  const req = toRequest(found)

  if (action === 'deny') {
    if (!await canReviewAccessRequests(actor)) {
      return { ok: false, error: 'Forbidden' }
    }
    const denied = await markResolved(id, 'denied', actor)
    return denied ? { ok: true, request: denied } : { ok: false, error: 'Already resolved' }
  }

  if (grant?.namespace && grant.role) {
    const review = await decideNamespaceAction(actor, grant.namespace, 'namespace.access.review')
    if (!review.allow) return { ok: false, error: review.reason }
    const result = await setNamespaceMember(
      grant.namespace,
      { sub: req.sub, iss: req.iss },
      grant.role,
    )
    if (!result.ok) return { ok: false, error: result.error }
  } else if (grant?.permission) {
    const admin = await decideInstanceAction(actor, 'instance.admin')
    if (!admin.allow) return { ok: false, error: admin.reason }
    const perms = new Set(await instancePermissions({ sub: req.sub, iss: req.iss }))
    perms.add(grant.permission)
    await setInstancePermissions(
      actor,
      { sub: req.sub, iss: req.iss },
      [...perms],
    )
  } else if ((await decideInstanceAction(actor, 'instance.admin')).allow) {
    await setInstancePermissions(actor, { sub: req.sub, iss: req.iss }, [
      'create_namespace',
    ])
  } else {
    return { ok: false, error: 'Specify namespace+role or permission to grant' }
  }

  const approved = await markResolved(id, 'approved', actor)
  return approved ? { ok: true, request: approved } : { ok: false, error: 'Already resolved' }
}
