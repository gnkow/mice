/** Public entry point for the shared module (leaf utilities only). */
export {
  filterAsync,
} from './lib/asyncArray.js'
export {
  systemClock,
  fakeClock,
  currentClock,
  useClock,
} from './lib/clock.js'
export type {
  FakeClock,
  Clock,
} from './lib/clock.js'
export {
  acquireDataDirLock,
} from './lib/dataDirLock.js'
export {
  writeJsonOnDisk,
  createDiskDocument,
  diskReadiness,
} from './lib/diskStore.js'
export type {
  DiskDocument,
} from './lib/diskStore.js'
export {
  loadEnv,
  env,
  overrideEnv,
  oidcConfigured,
} from './lib/env.js'
export {
  computeIpHash,
  normalizeClientIp,
  extractClientIp,
  resolveClientIp,
  createIpHash,
  getDailySalt,
  hashIp,
  hashFromHeaders,
  fingerprintFromHeaders,
  fingerprintFromRequest,
  getDisplaySuffix,
} from './lib/ipHash.js'
export type {
  IpHashDeps,
  IpFingerprint,
  IpHash,
} from './lib/ipHash.js'
export {
  nonCanonicalPathReason,
} from './lib/pathCanonical.js'
export type {
  AuditFields,
  AuditFn,
  AuditDep,
} from './lib/routeDeps.js'
