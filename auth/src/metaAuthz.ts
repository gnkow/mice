import { hasRepoPermission, preparePrincipal } from './authz.js'
import { isScopedCredential } from './principal.js'
import {
  hasInstancePermission,
  hasNamespaceCapability,
  isAuthzEnforce,
  isInstanceAdmin,
  userCanSeeNamespace,
} from './authzStore.js'
import type { EntityRef } from './metaTypes.js'
import type { SessionUser } from './session.js'

export type MetaAuthzDeps = {
  sessionOwner?: (id: string) => string | null
}

function selfKey(user: SessionUser): string {
  return `${user.iss}|${user.sub}`
}

/**
 * Metadata visibility = visibility of the target entity.
 *  - namespace: member / collaborator / admin
 *  - repo-scoped (repo, branch, commit, directory, file, workspace, job): repo read
 *  - session: owner or session_admin
 */
export function canReadEntity(
  user: SessionUser,
  ref: EntityRef,
  deps: MetaAuthzDeps = {},
): boolean {
  preparePrincipal(user)
  if (!isAuthzEnforce()) return true
  if (isInstanceAdmin(user) && !isScopedCredential(user)) return true
  switch (ref.type) {
    case 'namespace':
      return !!ref.namespace && userCanSeeNamespace(user, ref.namespace)
    case 'session':
      return (
        deps.sessionOwner?.(ref.id) === selfKey(user) ||
        hasInstancePermission(user, 'session_admin')
      )
    default:
      if (!ref.namespace || !ref.repo) return false
      return hasRepoPermission(user, ref.namespace, ref.repo, 'read', {
        method: 'GET',
        action: 'meta.read',
      }).ok
  }
}

/**
 * Metadata edit:
 *  - namespace: Owner / manage_settings (and instance admin)
 *  - repo-scoped: repo write, or the manage_repo_metadata fine permission
 *  - session: owner or session_admin
 */
export function canEditEntity(
  user: SessionUser,
  ref: EntityRef,
  deps: MetaAuthzDeps = {},
): boolean {
  preparePrincipal(user)
  if (!isAuthzEnforce()) return true
  if (isInstanceAdmin(user) && !isScopedCredential(user)) return true
  switch (ref.type) {
    case 'namespace':
      return (
        !!ref.namespace &&
        !isScopedCredential(user) &&
        hasNamespaceCapability(ref.namespace, user, 'manage_settings')
      )
    case 'session':
      return (
        deps.sessionOwner?.(ref.id) === selfKey(user) ||
        hasInstancePermission(user, 'session_admin')
      )
    default:
      if (!ref.namespace || !ref.repo) return false
      return hasRepoPermission(user, ref.namespace, ref.repo, 'write', {
        method: 'PATCH',
        action: 'meta.set',
      }).ok
  }
}
