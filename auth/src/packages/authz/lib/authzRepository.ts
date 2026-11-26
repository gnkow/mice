/** Thin re-export facade over focused authz repo modules (Wave 2 deepen). */
export {
  TOMBSTONE_MS,
  isNameReservedByTombstone,
} from './authzRepoTombstone.js'

export {
  sessionGroups,
  repoKey,
  bootstrapAllowlist,
  matchesBootstrap,
} from './authzRepoShared.js'

export {
  instancePermissionsOf,
  replaceInstancePermissions,
  listInstancePermissionRows,
  deleteExpiredInstancePermissions,
  isTrained,
  writeTrained,
} from './authzRepoInstance.js'

export type {
  NamespaceSettings,
  NamespaceSettingsPatch,
  NamespaceSettingsVersion,
  CreateNamespaceResult,
} from './authzRepoNamespace.js'
export {
  namespaceIdByName,
  namespaceNameById,
  readNamespace,
  readNamespaceById,
  readNamespaces,
  listNamespaceSettingsVersions,
  createNamespace,
  ensureNamespace,
  updateNamespaceSettings,
  deleteNamespace,
} from './authzRepoNamespace.js'

export type {
  MembershipSeat,
  NamespaceMembershipVersion,
} from './authzRepoMembership.js'
export {
  listNamespaceMembershipVersions,
  membershipRefs,
  directMemberRole,
  listMemberRows,
  memberCounts,
  isMemberRoleAssigned,
  ownedNamespaceNames,
  setMember,
  removeMember,
  setGroupMember,
  removeGroupMember,
} from './authzRepoMembership.js'

export type {
  RepositoryRecord,
  RepositorySettingsVersion,
} from './authzRepoRepository.js'
export {
  listRepositorySettingsVersions,
  readRepository,
  readRepositoryById,
  ensureRepository,
  createOwnedRepository,
  renameRepository,
  updateRepositoryDescription,
  deleteRepositoryRecord,
} from './authzRepoRepository.js'

export type {
  CollaboratorSeat,
  RepoCollaboratorVersion,
} from './authzRepoCollaborator.js'
export {
  listRepoCollaboratorVersions,
  directCollaboratorRole,
  groupCollaboratorRoles,
  listCollaboratorRows,
  listNamespaceGroupCollaboratorRows,
  listAllCollaboratorRows,
  isRepoRoleAssigned,
  hasCollaboratorGrantIn,
  collaboratorNamespaces,
  hasAnyCollaboratorGrant,
  setCollaborator,
  removeCollaborator,
  setGroupCollaborator,
  removeGroupCollaborator,
} from './authzRepoCollaborator.js'

export type {
  ApproverScope,
  ApproverVersion,
} from './authzRepoApprover.js'
export {
  addApprover,
  removeApprover,
  listApproverVersions,
  listApproverKeys,
  isApproverKey,
} from './authzRepoApprover.js'
