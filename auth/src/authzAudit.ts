import type { SessionUser } from './authentication/index.js'
import { namespacesWithCapability } from './authzMembershipStore.js'
import { ownedNamespaces } from './authzVisibility.js'
import { hasPermission } from './rbacStore.js'

/** Result of authorizing an audit trail read (list / export / facets). */
export type AuditQueryAuthorization = {
  allow: boolean
  forceNamespace?: string
  ownedOnly?: string[]
  reason?: string
}

/**
 * AuthZ for audit read: instance `audit:read` sees everything; otherwise the caller is
 * limited to namespaces they own or where they hold `view_audit`.
 */
export async function authorizeAuditQuery(
  user: SessionUser,
  requestedNamespace?: string,
): Promise<AuditQueryAuthorization> {
  if (await hasPermission(user, 'audit:read')) return { allow: true }
  const scoped = [
    ...new Set([
      ...(await ownedNamespaces(user)),
      ...(await namespacesWithCapability(user, 'view_audit')),
    ]),
  ]
  if (scoped.length === 0) {
    return { allow: false, reason: 'Missing permission view_audit' }
  }
  if (requestedNamespace) {
    if (!scoped.includes(requestedNamespace)) {
      return { allow: false, reason: 'Not allowed to audit that namespace' }
    }
    return { allow: true, forceNamespace: requestedNamespace }
  }
  if (scoped.length === 1) {
    return { allow: true, forceNamespace: scoped[0] }
  }
  return {
    allow: true,
    ownedOnly: scoped,
  }
}
