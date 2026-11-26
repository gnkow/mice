/** Public entry point for the proxy module. */
export { setUpstreamFetch, proxyToOxen } from './lib/proxy.js'
export type { ProxyAuth } from './lib/proxy.js'

/** Body / change / effects / lineage helpers used by callers and package tests. */
export { interpretRequestBody } from './lib/proxyBody.js'
export type { InterpretedBody } from './lib/proxyBody.js'
export {
  UNVERIFIED,
  workspaceIdFromAnswer,
  workspaceFilePathsFromPathname,
  proxyMutationChange,
} from './lib/proxyChange.js'
export type { FileHashDelta, ProxyChangeInput } from './lib/proxyChange.js'
export {
  filterNamespaceCatalog,
  seedRepoCreate,
  attachRepositoryId,
  finalizeProxiedRepoCreate,
  ensureBranchCreateSourceTip,
  stampRepositoryIdOnRepoDetail,
  recordAclBypassRead,
} from './lib/proxyEffects.js'
export type { SeededRepository, FinalizeRepoCreateOptions } from './lib/proxyEffects.js'
export { createDatasetCapture, createLineageCapture } from './lib/proxyLineage.js'
export type { DatasetCapture, DatasetVersions, LineageCapture } from './lib/proxyLineage.js'
