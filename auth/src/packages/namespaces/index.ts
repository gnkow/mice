/** Public entry point for the namespaces module. */
export {
  isRenamePathChange,
  pathChangeKind,
  inferCopyPairs,
  classifyFileLineageOp,
  parseFileEntrySnapshot,
  fetchFileEntrySnapshot,
  readFileEntrySnapshot,
  validateArity,
  parseCommitIdFromJson,
  versionKey,
  pathKey,
  fileVersionKeys,
  fileVersionKey,
  derivedOpId,
  producerIndex,
  pruneDuplicateProducers,
  appendLineage,
  queryLineage,
  deriveOpsFromPathHistory,
  deriveMoveHeuristic,
  deriveCopyHeuristic,
  deriveCopiesFromCommitDiff,
  buildExplicitFileOp,
} from './lib/lineage.js'
export type {
  LineageKind,
  CommitDiffPath,
  LineageSource,
  LineageConfidence,
  FileVersion,
  LineageOp,
  LineageQuery,
  FileEntrySnapshot,
  PathVersionHint,
} from './lib/lineage.js'
export {
  ensureEmptyOxenBranch,
} from './lib/oxenEmptyBranch.js'
export type {
  EmptyTipOptions,
  EmptyBranchActor,
} from './lib/oxenEmptyBranch.js'
export {
  isPhysicalOxenKey,
  rewriteReposApiPathToPhysical,
  rewriteRepoListPathToPhysical,
  rewriteNamespacePathToPhysical,
  rewriteOxenJsonToDisplay,
  physicalCreateBody,
  initialCommitMessageFromBody,
  createBranchPlanFromBody,
  createBranchesOptionFromBody,
  miceCreateOptionsFromBodies,
} from './lib/oxenPhysicalKeys.js'
export type {
  PhysicalRepoRef,
  DisplayRepoRef,
  CreateBranchPlan,
  CreateBranchesOption,
} from './lib/oxenPhysicalKeys.js'
export {
  resolveNamespaceId,
  resolvePhysicalRepo,
  displayNamespaceName,
  displayRepoRef,
  preparePhysicalRepoCreate,
  mapDisplayRequestToPhysical,
  mapPhysicalResponseToDisplay,
} from './lib/oxenPhysicalResolve.js'
export type {
  DisplayRequestContext,
  PhysicalUpstreamMapping,
  MapDisplayRequestResult,
  DisplayResponseHints,
} from './lib/oxenPhysicalResolve.js'
