import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
// env.dataDir via path()
import type { SessionUser } from './session.js'
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

type Store = { version: 1; requests: AccessRequest[] }

function path() {
  return join(env.dataDir, 'access-requests.json')
}

function read(): Store {
  const s = readJsonFile(path(), { version: 1, requests: [] } as Store)
  if (!s || s.version !== 1 || !Array.isArray(s.requests)) {
    return { version: 1, requests: [] }
  }
  return s
}

function write(s: Store) {
  writeJsonFile(path(), s)
}

export function listAccessRequests(opts?: {
  pendingOnly?: boolean
}): AccessRequest[] {
  let list = read().requests
  if (opts?.pendingOnly) list = list.filter((r) => r.status === 'pending')
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function canReviewAccessRequests(actor: SessionUser): boolean {
  return decideAccessReview(actor).allow
}

export function submitAccessRequest(
  user: SessionUser,
  message: string,
): AccessRequest {
  const store = read()
  const existing = store.requests.find(
    (r) =>
      r.status === 'pending' && r.sub === user.sub && r.iss === user.iss,
  )
  if (existing) return existing
  const req: AccessRequest = {
    id: randomBytes(8).toString('hex'),
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
    message: message.trim().slice(0, 500),
    createdAt: new Date().toISOString(),
    status: 'pending',
  }
  store.requests.push(req)
  write(store)
  return req
}

export function resolveAccessRequest(
  actor: SessionUser,
  id: string,
  action: 'approve' | 'deny',
  grant?: {
    namespace?: string
    role?: MemberRoleRef
    permission?: InstancePermission
  },
): { ok: true; request: AccessRequest } | { ok: false; error: string } {
  const store = read()
  const req = store.requests.find((r) => r.id === id)
  if (!req) return { ok: false, error: 'Not found' }
  if (req.status !== 'pending') return { ok: false, error: 'Already resolved' }

  if (action === 'deny') {
    if (!canReviewAccessRequests(actor)) {
      return { ok: false, error: 'Forbidden' }
    }
    req.status = 'denied'
    req.resolvedAt = new Date().toISOString()
    req.resolvedBy = userKey(actor)
    write(store)
    return { ok: true, request: req }
  }

  if (grant?.namespace && grant.role) {
    const review = decideNamespaceAction(actor, grant.namespace, 'namespace.access.review')
    if (!review.allow) return { ok: false, error: review.reason }
    const result = setNamespaceMember(
      grant.namespace,
      { sub: req.sub, iss: req.iss },
      grant.role,
    )
    if (!result.ok) return { ok: false, error: result.error }
  } else if (grant?.permission) {
    const admin = decideInstanceAction(actor, 'instance.admin')
    if (!admin.allow) return { ok: false, error: admin.reason }
    const perms = new Set(instancePermissions({ sub: req.sub, iss: req.iss }))
    perms.add(grant.permission)
    setInstancePermissions(
      actor,
      { sub: req.sub, iss: req.iss },
      [...perms],
    )
  } else if (decideInstanceAction(actor, 'instance.admin').allow) {
    setInstancePermissions(actor, { sub: req.sub, iss: req.iss }, [
      'create_namespace',
    ])
  } else {
    return { ok: false, error: 'Specify namespace+role or permission to grant' }
  }

  req.status = 'approved'
  req.resolvedAt = new Date().toISOString()
  req.resolvedBy = userKey(actor)
  write(store)
  return { ok: true, request: req }
}
