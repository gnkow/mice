import { canReviewAccessRequests } from './accessRequests.js'
import { isPendingUser, preparePrincipal } from './authz.js'
import { isInstanceAdmin } from './authzInstanceStore.js'
import { namespacesWithCapability } from './authzMembershipStore.js'
import type { SessionUser } from './session.js'

/** Who may query the directory: not pending, and an admin, access-request reviewer or member manager. */
export async function canSearchDirectory(user: SessionUser): Promise<boolean> {
  await preparePrincipal(user)
  if (await isPendingUser(user)) return false
  if (await isInstanceAdmin(user)) return true
  if (await canReviewAccessRequests(user)) return true
  if ((await namespacesWithCapability(user, 'manage_members')).length > 0) return true
  return false
}
