import { normalizeGroup } from '../../authzTypes.js'
import { groupBindingKey, parseGroupBindingKey } from '../../groupBinding.js'
import { directoryNow } from '../directory/directory.js'
import type { Directory, DirectoryGroup } from '../directory/directoryTypes.js'
import type { SessionUser } from '../session/session.js'

/**
 * Session groups that are still present in a directory listing.
 * A group added in the IdP since login stays unused until the next Session.
 */
export function intersectSessionWithDirectoryGroups(
  sessionGroups: readonly string[],
  listed: readonly DirectoryGroup[],
  issuer: string,
): string[] {
  const live = new Set<string>()
  for (const group of listed) {
    live.add(group.id)
    live.add(normalizeGroup(group.id))
    live.add(normalizeGroup(group.name))
    if (group.id) live.add(groupBindingKey(issuer, group.id))
  }
  return sessionGroups.filter((group) => {
    if (live.has(group) || live.has(normalizeGroup(group))) return true
    const parsed = parseGroupBindingKey(group)
    return !!(parsed && (live.has(parsed.groupId) || live.has(normalizeGroup(parsed.groupId))))
  })
}

/** Session groups that the directory still lists. Throws status 503 when the directory cannot answer. */
export async function withDirectoryGroups(
  user: SessionUser,
  deps: { directory?: Directory } = {},
): Promise<SessionUser> {
  const directory = deps.directory ?? directoryNow()
  let listed: DirectoryGroup[]
  try {
    listed = await directory.getUserGroups(user.sub)
  } catch {
    throw Object.assign(new Error('Directory unavailable'), { status: 503 })
  }
  const iss = directory.issuer || user.iss
  return {
    ...user,
    groups: intersectSessionWithDirectoryGroups(user.groups ?? [], listed, iss),
  }
}

/** Loads the directory groups for a sign, merge, or admin action. Throws status 503 when the directory cannot answer. */
export async function confirmPrivilegedGroups(user: SessionUser): Promise<SessionUser> {
  return withDirectoryGroups(user)
}
