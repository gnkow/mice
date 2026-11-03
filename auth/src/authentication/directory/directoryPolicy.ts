import { isPendingUser, preparePrincipal } from '../../authz.js'
import { namespacesWithCapability } from '../../authzMembershipStore.js'
import { hasPermission } from '../../rbacStore.js'
import type { SessionUser } from '../session/session.js'

/** Who may query the directory: not pending, and directory:search or manage_members somewhere. */
export async function canSearchDirectory(user: SessionUser): Promise<boolean> {
  await preparePrincipal(user)
  if (await isPendingUser(user)) return false
  if (await hasPermission(user, 'directory:search')) return true
  if ((await namespacesWithCapability(user, 'manage_members')).length > 0) return true
  return false
}
