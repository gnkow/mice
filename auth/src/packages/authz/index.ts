/** Public entry point for the authz module. */

export * from './lib/authz.js'
export * from './lib/authzAlwaysOn.js'
export * from './lib/authzVisibility.js'
export * from './lib/authzPathMap.js'
export * from './lib/authzRouteDocs.js'
export * from './lib/authzTypes.js'
export {
  INSTANCE_PERMISSIONS,
  NAMESPACE_ROLES,
  REPO_ROLES,
  APPROVER_ROLE,
  NAMESPACE_CAPABILITIES,
  REPO_FINE_PERMISSIONS,
  isRepoRole,
  parseAuthzMe,
} from './lib/authzContract.js'
export type { AuthzMe } from './lib/authzContract.js'
export * from './lib/authzRepository.js'
export * from './lib/authzInstanceStore.js'
export {
  getNamespace,
  listNamespacesAuthz,
  listNamespacesForUser,
  createNamespaceAuthz,
  ensureNamespaceForCreate,
  listNamespaceSettingsHistory,
  listNamespaceMembershipHistory,
  deleteNamespaceAuthz,
  updateNamespaceSettings as updateNamespaceSettingsAuthz,
} from './lib/authzNamespaceStore.js'
export * from './lib/authzMembershipStore.js'
export * from './lib/authzCollaboratorStore.js'
export {
  isUserApproverStorageKey,
  approverStorageKey,
  parseApproverStorageKey,
  mutateApproverSeat,
  grantApprover,
  revokeApprover,
  listApprovers,
  listApproverHistory,
  isApprover,
  parseApproverTargetFromBody,
} from './lib/authzApproverStore.js'
export type {
  ApproverDecision,
  ApproverPrincipal,
  GrantApproverResult,
  ApproverTargetBody,
} from './lib/authzApproverStore.js'
export * from './lib/customRoles.js'
export * from './lib/groupBinding.js'
export * from './lib/groupBindingMode.js'
export * from './lib/groupBindingStatusStore.js'
export * from './lib/groupDisplayStore.js'
export * from './lib/adminMinimum.js'
export * from './lib/accessRequests.js'
export * from './lib/principalBootstrap.js'
export * from './lib/delegatedInstanceExpiry.js'
export {
  runInstancePermissionExpiry,
  startInstancePermissionExpirySchedule,
} from './lib/instancePermissionExpiry.js'
export type {
  InstancePermissionExpiryAudit,
  RevokeExpiredInstancePermissions,
} from './lib/instancePermissionExpiry.js'
export * from './lib/repoViewerPermissions.js'
export {
  INSTANCE_PERMISSION_CATALOG,
  isInstancePermission,
} from './lib/rbacCatalog.js'
export type { InstancePermission as RbacInstancePermission } from './lib/rbacCatalog.js'
export {
  INSTANCE_ROLES,
  getRolePermissions,
  isInstanceRole,
} from './lib/rbacRoles.js'
export type { InstanceRole } from './lib/rbacRoles.js'
export * from './lib/rbacEffective.js'
export * from './lib/rbacAuthority.js'
export {
  getUserRole,
  getRoleAuditSnapshot,
  getPermissionAuditSnapshot,
  listRoleHistory,
  listAdminPrincipals,
  assignRole,
  revokeRole,
  listPermissionSnapshots,
  getCustomPermissions,
  listPermissionHistory,
  grantCustomPermissions,
  getEffectivePermissions,
  hasPermission,
  revokeCustomPermissions,
  listRbacUsers,
} from './lib/rbacStore.js'
export type {
  RoleHistoryEntry,
  PermissionHistoryEntry,
  PermissionSnapshot,
  RbacUserRow,
} from './lib/rbacStore.js'
export * from './lib/rbacDirectGrant.js'
export {
  getAccessRequest,
  getOwnPendingAccessRequest,
  listAccessRequestsForReviewer,
  approveAccessRequest,
  denyAccessRequest,
  submitAccessRequest as submitRbacAccessRequest,
} from './lib/rbacAccessRequests.js'
export type { RbacAccessRequest } from './lib/rbacAccessRequests.js'
export {
  ensureRepository,
  transferRepository,
  previewRepositoryTransfer,
  proposeRepositoryTransfer,
  acceptRepositoryTransfer,
  rejectRepositoryTransfer,
  cancelRepositoryTransfer,
  getPendingRepositoryTransfer,
  listIncomingPendingTransfers,
  expirePendingTransfers,
  partitionTransferAccess,
  TRANSFER_PENDING_TTL_MS,
} from './lib/repositoryStore.js'
export type {
  RepositoryTransferRecord,
  TransferAccessDiff,
  TransferCompleteResult,
  TransferProposeResult,
} from './lib/repositoryStore.js'


export { defaultGroupIssuer, setGroupIssuerOverride } from './lib/groupIssuer.js'

export * from './lib/authzAudit.js'

export * from './lib/authzRepoHistory.js'

export * from './lib/authzRepoMembership.js'

export * from './lib/authzRepoNamespace.js'

export * from './lib/authzRepoRepository.js'

export * from './lib/authzRepoShared.js'

export { denialResponse, instanceGate, adminRoleGate } from './lib/decisionHttp.js'
