/** Public entry point for the platform module. */
export {
  ANNOUNCEMENT_SEVERITIES,
  MAX_TITLE,
  MAX_MESSAGE,
  AnnouncementError,
  isLive,
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from './lib/announcementsStore.js'
export type {
  AnnouncementSeverity,
  Announcement,
} from './lib/announcementsStore.js'
export {
  evaluateBackupTarget,
  backupTargetProblems,
  recordBackupTargetCheck,
} from './lib/backupTarget.js'
export type {
  BackupTargetEvaluation,
} from './lib/backupTarget.js'
export {
  runCrossStoreIntegrity,
  startCrossStoreIntegritySchedule,
} from './lib/crossStoreIntegrity.js'
export type {
  IntegrityFinding,
  IntegrityReport,
  IntegrityScheduleDeps,
} from './lib/crossStoreIntegrity.js'
export {
  appendVersionInterval,
} from './lib/entityVersionAppend.js'
export {
  ENTITY_VERSION_INVENTORY,
  entityVersionInventory,
  versionedEntities,
  exemptEntities,
  decideInventoryComplete,
} from './lib/entityVersionInventory.js'
export type {
  VersioningStatus,
  EntityVersionEntry,
} from './lib/entityVersionInventory.js'
export {
  looksLikeUuid,
  canonicalizeFavorite,
} from './lib/favoritesCanonical.js'
export type {
  CanonicalFavorite,
} from './lib/favoritesCanonical.js'
export {
  FAVORITE_TYPES,
  normalizeFavoriteType,
  favoriteUserKey,
  listFavorites,
  addFavorite,
  removeFavorite,
  purgeFavoritesForAudit,
} from './lib/favoritesStore.js'
export type {
  FavoriteType,
  FavoriteRow,
} from './lib/favoritesStore.js'
export {
  canReadEntity,
  canEditEntity,
} from './lib/metaAuthz.js'
export type {
  MetaAuthzDeps,
} from './lib/metaAuthz.js'
export {
  resolveEffective,
} from './lib/metaResolve.js'
export type {
  GetOwn,
  EffectiveMeta,
} from './lib/metaResolve.js'
export {
  lookup,
  resolveRef,
} from './lib/metaRoutes.js'
export {
  parseTerms,
  parseQuerySyntax,
  searchMeta,
} from './lib/metaSearch.js'
export type {
  MetaSearchQuery,
  MetaSearchHit,
  MetaFacets,
  SearchCtx,
} from './lib/metaSearch.js'
export {
  getOwnRecord,
  listOwnRecords,
  getRevision,
  listHistory,
  buildRecord,
  putOwnRecord,
  deleteOwnRecord,
} from './lib/metaStore.js'
export type {
  MetaRevision,
} from './lib/metaStore.js'
export {
  ENTITY_TYPES,
  LIMITS,
  MetaError,
  normalizeTag,
  normalizeKey,
  assertKey,
  assertTag,
  assertValue,
  formatRef,
  refKey,
  parseRef,
  withRepoScope,
  refLabel,
  metaUrl,
} from './lib/metaTypes.js'
export type {
  EntityType,
  EntityRef,
  MetaValue,
  MetaRecord,
  MetaPatch,
} from './lib/metaTypes.js'
export {
  REASON_POLICY_INVENTORY,
  reasonPolicyInventory,
  inventoryRequiredDatasetActions,
  inventoryCreateExemptActions,
} from './lib/reasonPolicyInventory.js'
export type {
  ReasonRequirement,
  ReasonPolicyEntry,
} from './lib/reasonPolicyInventory.js'
export {
  effectiveRegulatedConfig,
  regulatedConfigDigest,
  regulatedConfigStatus,
  resetRegulatedConfigStatus,
  evaluateRegulatedConfigAtStart,
  recordRegulatedConfigAtStart,
  recordRegulatedConfigChange,
} from './lib/regulatedConfig.js'
export type {
  EffectiveRegulatedConfig,
  RegulatedConfigStatus,
  RegulatedConfigEvaluation,
  RecordRegulatedConfigOpts,
} from './lib/regulatedConfig.js'
export {
  RELEASE_MANIFEST_PUBLIC_KEY_PEM,
  RELEASE_MANIFEST_FORMAT,
  liveReleaseComponents,
  compareReleaseComponents,
  signReleaseManifest,
  verifyReleaseManifestSignature,
  buildReleaseManifestBody,
  loadSignedReleaseManifest,
  releaseManifestStatus,
  resetReleaseManifestStatus,
  verifyReleaseManifestAt,
  defaultReleaseManifestPath,
  recordReleaseManifestCheck,
  verifyAndRecordReleaseManifest,
} from './lib/releaseManifest.js'
export type {
  ReleaseComponentId,
  ReleaseComponentIdentity,
  ReleaseManifestBody,
  SignedReleaseManifest,
  ReleaseManifestStatus,
} from './lib/releaseManifest.js'
export {
  resetRestoreTestGate,
  simulateRestoreTestProcessRestart,
  restoreTestStatus,
  loadRestoreTestStatus,
  recordRestoreTestPassed,
  RESTORE_TEST_REQUIRED,
  decideRestoreTestGate,
} from './lib/restoreTestGate.js'
export type {
  RestoreTestStatus,
} from './lib/restoreTestGate.js'
export {
  SERVICE_PRINCIPALS_REMOVED,
  RETIRED_SERVICE_PRINCIPAL_PATHS,
  RETIRED_SERVICE_ISSUER,
} from './lib/servicePrincipalsRemoved.js'
export {
  GXP_REQUIREMENT_ID_RE,
  GXP_REQUIREMENT_CATALOG,
  extractGxpRequirementIds,
  buildTraceabilityMatrixFromTestNames,
  traceabilityMatrixDigest,
  recordTraceabilityMatrixRelease,
} from './lib/traceabilityMatrix.js'
