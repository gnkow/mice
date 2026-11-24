import {
  canAdministerRepository,
  decideManageApprovers,
  decideManageRepoCollaborators,
  hasRepoPermission,
} from './authz.js'
import { decideIsApprover } from './authzApproverStore.js'
import type { SessionUser } from './authentication/index.js'
import { canEditEntity } from './metaAuthz.js'

/**
 * Caller-facing capabilities for repository settings chrome + file browser (#148).
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
  /** Tip-changing file ops (upload/rename/move/copy/delete) need write collaborator. */
  contentsWrite: boolean
  /** Explicit Approver seat (user or group); not implied by write/maintain/Owner. */
  isApprover: boolean
}

export type RepoViewerPermissionsResult =
  | { ok: true; permissions: RepoViewerPermissions }
  | { ok: false; status: 403 }

/**
 * Assemble the viewer permissions payload for GET …/repos/:repo/permissions.
 * Locality: one decide owns the chrome contract so the route stays a thin adapter.
 * Owners may open settings without a collaborator seat; data plane still needs read.
 */
export async function decideRepoViewerPermissions(
  user: SessionUser,
  ns: string,
  repo: string,
): Promise<RepoViewerPermissionsResult> {
  const read = await hasRepoPermission(user, ns, repo, 'read')
  const administer = await canAdministerRepository(user, ns, repo)
  if (!read.ok && !administer) return { ok: false, status: 403 }

  const write = await hasRepoPermission(user, ns, repo, 'write')
  const [manageCollaborators, manageApprovers, editMetadata, approver] =
    await Promise.all([
      decideManageRepoCollaborators(user, ns, repo),
      decideManageApprovers(user, ns),
      canEditEntity(user, { type: 'repo', id: `${ns}/${repo}`, namespace: ns, repo }),
      decideIsApprover(user, ns, repo),
    ])

  return {
    ok: true,
    permissions: {
      rename: administer,
      transfer: administer,
      manageCollaborators: manageCollaborators.allow,
      manageApprovers: manageApprovers.allow,
      editMetadata,
      deleteRepository: administer,
      // Readers may open signed-record / approvers / metadata views; mutate chrome is separate.
      viewSignedRecord: true,
      contentsWrite: write.ok && !write.bypass,
      isApprover: approver.allow,
    },
  }
}
