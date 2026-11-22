import {
  decideManageApprovers,
  decideManageRepoCollaborators,
  hasRepoPermission,
} from './authz.js'
import type { SessionUser } from './authentication/index.js'
import { canEditEntity } from './metaAuthz.js'

/**
 * Caller-facing capabilities for repository settings chrome (#148).
 * UI hides mutate sections from these flags; enforcement still lives on each route.
 */
export type RepoViewerPermissions = {
  rename: boolean
  transfer: boolean
  manageCollaborators: boolean
  manageApprovers: boolean
  editMetadata: boolean
  deleteRepository: boolean
  viewSignedRecord: boolean
}

export type RepoViewerPermissionsResult =
  | { ok: true; permissions: RepoViewerPermissions }
  | { ok: false; status: 403 }

/**
 * Assemble the viewer permissions payload for GET …/repos/:repo/permissions.
 * Locality: one decide owns the chrome contract so the route stays a thin adapter.
 */
export async function decideRepoViewerPermissions(
  user: SessionUser,
  ns: string,
  repo: string,
): Promise<RepoViewerPermissionsResult> {
  const read = await hasRepoPermission(user, ns, repo, 'read')
  if (!read.ok) return { ok: false, status: 403 }

  const admin = await hasRepoPermission(user, ns, repo, 'admin')
  const repoAdmin = admin.ok && !admin.bypass
  const [manageCollaborators, manageApprovers, editMetadata] = await Promise.all([
    decideManageRepoCollaborators(user, ns, repo),
    decideManageApprovers(user, ns),
    canEditEntity(user, { type: 'repo', id: `${ns}/${repo}`, namespace: ns, repo }),
  ])

  return {
    ok: true,
    permissions: {
      rename: repoAdmin,
      transfer: repoAdmin,
      manageCollaborators: manageCollaborators.allow,
      manageApprovers: manageApprovers.allow,
      editMetadata,
      deleteRepository: repoAdmin,
      // Readers may open signed-record / approvers / metadata views; mutate chrome is separate.
      viewSignedRecord: true,
    },
  }
}
