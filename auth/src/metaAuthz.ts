import { decideInstanceAction, decideNamespaceAction, hasRepoPermission, isUnscopedInstanceAdmin } from './authz.js'
import { userCanSeeNamespace } from './authzVisibility.js'
import type { EntityRef } from './metaTypes.js'
import { type SessionUser } from './authentication/index.js'

export type MetaAuthzDeps = {
  sessionOwner?: (id: string) => string | null | Promise<string | null>
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
export async function canReadEntity(
  user: SessionUser,
  ref: EntityRef,
  deps: MetaAuthzDeps = {},
): Promise<boolean> {
  if (await isUnscopedInstanceAdmin(user)) return true
  switch (ref.type) {
    case 'namespace':
      return !!ref.namespace && await userCanSeeNamespace(user, ref.namespace)
    case 'session':
      return (
        (await deps.sessionOwner?.(ref.id)) === selfKey(user) ||
        (await decideInstanceAction(user, 'session.admin')).allow
      )
    default:
      if (!ref.namespace || !ref.repo) return false
      return (await hasRepoPermission(user, ref.namespace, ref.repo, 'read', {
        method: 'GET',
        action: 'meta.read',
      })).ok
  }
}

/**
 * Metadata edit:
 *  - namespace: Owner / manage_settings (and instance admin)
 *  - repo-scoped: repo write, or the manage_repo_metadata fine permission
 *  - session: owner or session_admin
 */
export async function canEditEntity(
  user: SessionUser,
  ref: EntityRef,
  deps: MetaAuthzDeps = {},
): Promise<boolean> {
  if (await isUnscopedInstanceAdmin(user)) return true
  switch (ref.type) {
    case 'namespace':
      return (
        !!ref.namespace &&
        (await decideNamespaceAction(user, ref.namespace, 'namespace.settings.metadata')).allow
      )
    case 'session':
      return (
        (await deps.sessionOwner?.(ref.id)) === selfKey(user) ||
        (await decideInstanceAction(user, 'session.admin')).allow
      )
    default:
      if (!ref.namespace || !ref.repo) return false
      return (await hasRepoPermission(user, ref.namespace, ref.repo, 'write', {
        method: 'PATCH',
        action: 'meta.set',
      })).ok
  }
}
