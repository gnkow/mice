import { canReviewAccessRequests } from './accessRequests.js'
import { isPendingUser, preparePrincipal } from './authz.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
import { namespacesWithCapability } from './authzMembershipStore.js'
import type { SessionUser } from './session.js'

/** Who may query the directory: not pending, and an admin, access-request reviewer or member manager. */
export function canSearchDirectory(user: SessionUser): boolean {
  preparePrincipal(user)
  if (isPendingUser(user)) return false
  if (isInstanceAdmin(user)) return true
  if (canReviewAccessRequests(user)) return true
  if (namespacesWithCapability(user, 'manage_members').length > 0) return true
  return false
}
