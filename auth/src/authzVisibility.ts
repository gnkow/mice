import { userKey, type UserKey } from './authzTypes.js'
import { instancePermissions, isInstanceAdmin } from './authzInstanceStore.js'
import { namespaceRolesFor, resolveNamespaceRole } from './authzMembershipStore.js'
import * as repo from './authzRepository.js'

type Who = UserKey & { groups?: string[] }
const who = (user: Who) => ({ key: userKey(user), groups: repo.sessionGroups(user) })

/**
 * True if the user is a namespace member/owner, instance admin, or has any
 * repo collaborator grant (user or IdP group) under the namespace.
 */
export async function userCanSeeNamespace(user: Who, ns: string): Promise<boolean> {
  if (await isInstanceAdmin(user)) return true
  if (await resolveNamespaceRole(ns, user)) return true
  return repo.hasCollaboratorGrantIn(ns, who(user))
}

/** Namespace names visible to the user (member, collab, or instance admin). */
export async function visibleNamespaceNames(user: Who): Promise<string[] | 'all'> {
  if (await isInstanceAdmin(user)) return 'all'
  const seats = await namespaceRolesFor(user)
  const collab = new Set(await repo.collaboratorNamespaces(who(user)))
  const names = Object.keys(await repo.readNamespaces())
  return names.filter((ns) => seats.get(ns) || collab.has(ns)).sort()
}

export async function userHasAnyGrant(user: Who): Promise<boolean> {
  if (await isInstanceAdmin(user)) return true
  if ((await instancePermissions(user)).length > 0) return true
  const w = who(user)
  if ((await repo.membershipRefs(w)).length > 0) return true
  return repo.hasAnyCollaboratorGrant(w)
}

export async function ownedNamespaces(user: Who): Promise<string[]> {
  return repo.ownedNamespaceNames(who(user))
}
