/** Leaf types + group binding helpers (safe for lower layers). */
export * from './lib/authzTypes.js'
export * from './lib/groupBinding.js'
export { defaultGroupIssuer, setGroupIssuerOverride } from './lib/groupIssuer.js'
export type { InstanceRole, AuthzMe, NamespaceRole, RepoRole, NamespaceCapability, RepoFinePermission } from './lib/authzContract.js'
export {
  INSTANCE_ROLES,
  INSTANCE_PERMISSIONS,
  isInstanceRole,
  isInstancePermission,
  isRepoRole,
} from './lib/authzContract.js'
export { INSTANCE_PERMISSION_CATALOG } from './lib/rbacCatalog.js'

export { getGroupDisplayName, getGroupDisplayNames, upsertGroupDisplayNames } from './lib/groupDisplayStore.js'
