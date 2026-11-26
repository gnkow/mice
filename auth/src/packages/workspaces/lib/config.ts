import { join } from 'node:path'

/** Tunables for the checkout store and Mice workspaces (plan §11). Read lazily so tests can override. */
export type WorkspacesConfig = {
  storeDir: string
  wsDir: string
  driverPref: 'auto' | 'overlay' | 'reflink' | 'copy'
  uid: number | null
  gid: number | null
  storeVolume: string
  wsVolume: string
  hostStoreDir: string
  hostWsDir: string
  probeImage: string
  downloadConcurrency: number
  listConcurrency: number
  downloadRetries: number
  downloadRetryBaseMs: number
  keepPerRepo: number
  ttlDays: number
  blobMinAgeMs: number
  storeMaxBytes: number | null
  prewarm: boolean
  prewarmIntervalSec: number
  gcIntervalSec: number
  scrubIntervalSec: number
  scrubFraction: number
  tmpKeepMs: number
  lockStaleMs: number
  wsMaxBytes: number
  wsMaxFiles: number
  wsMaxTotalBytes: number | null
  wsMaxFileBytes: number
  copyMaxFiles: number
  prepareTimeoutSec: number
  retryBackoffMs: number[]
  scanTtlMs: number
  leaseTtlSec: number
  leaseMaxTtlSec: number
  leaseReconcileSec: number
  /** Holder not found in the jobs/sessions store is only released after this age. */
  leaseOrphanGraceMs: number
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function optNum(name: string): number | null {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function loadWorkspacesConfig(): WorkspacesConfig {
  const data = (process.env.AUTH_DATA_DIR ?? './data').replace(/\/$/, '')
  const pref = (process.env.WORKSPACES_DRIVER ?? 'auto').toLowerCase()
  return {
    storeDir: process.env.WORKSPACES_STORE_DIR ?? join(data, 'store'),
    wsDir: process.env.WORKSPACES_DIR ?? join(data, 'workspaces'),
    driverPref: (['auto', 'overlay', 'reflink', 'copy'].includes(pref)
      ? pref
      : 'auto') as WorkspacesConfig['driverPref'],
    uid: Math.floor(num('WORKSPACES_UID', 1000)),
    gid: Math.floor(num('WORKSPACES_GID', 1000)),
    storeVolume: process.env.WORKSPACES_STORE_VOLUME || 'mice-store',
    wsVolume: process.env.WORKSPACES_VOLUME || 'mice-workspaces',
    hostStoreDir: (process.env.WORKSPACES_HOST_STORE_DIR ?? '').replace(/\/$/, ''),
    hostWsDir: (process.env.WORKSPACES_HOST_WS_DIR ?? '').replace(/\/$/, ''),
    probeImage: process.env.WORKSPACES_PROBE_IMAGE || 'alpine:3.20',
    downloadConcurrency: Math.max(1, num('CHECKOUT_DOWNLOAD_CONCURRENCY', 8)),
    listConcurrency: Math.max(1, num('CHECKOUT_LIST_CONCURRENCY', 8)),
    downloadRetries: num('CHECKOUT_DOWNLOAD_RETRIES', 3),
    downloadRetryBaseMs: num('CHECKOUT_DOWNLOAD_RETRY_BASE_MS', 500),
    keepPerRepo: num('CHECKOUT_KEEP_PER_REPO', 3),
    ttlDays: num('CHECKOUT_TTL_DAYS', 14),
    blobMinAgeMs: num('CHECKOUT_BLOB_MIN_AGE_SEC', 3600) * 1000,
    storeMaxBytes: optNum('WORKSPACES_STORE_MAX_BYTES'),
    prewarm: (process.env.CHECKOUT_PREWARM ?? 'true') !== 'false',
    prewarmIntervalSec: num('CHECKOUT_PREWARM_INTERVAL_SEC', 60),
    gcIntervalSec: num('CHECKOUT_GC_INTERVAL_SEC', 3600),
    scrubIntervalSec: num('CHECKOUT_SCRUB_INTERVAL_SEC', 7 * 24 * 3600),
    scrubFraction: Math.min(1, num('CHECKOUT_SCRUB_FRACTION', 0.05)),
    tmpKeepMs: 24 * 3600 * 1000,
    lockStaleMs: 60_000,
    wsMaxBytes: num('WORKSPACES_MAX_BYTES', 50 * 1024 ** 3),
    wsMaxFiles: num('WORKSPACES_MAX_FILES', 1_000_000),
    wsMaxTotalBytes: optNum('WORKSPACES_MAX_TOTAL_BYTES'),
    wsMaxFileBytes: num('WORKSPACES_MAX_FILE_BYTES', 5 * 1024 ** 3),
    copyMaxFiles: num('WORKSPACES_COPY_MAX_FILES', 200_000),
    prepareTimeoutSec: num('WORKSPACES_PREPARE_TIMEOUT_SEC', 3600),
    retryBackoffMs: [60_000, 5 * 60_000, 15 * 60_000],
    scanTtlMs: 3000,
    leaseTtlSec: Math.max(1, num('WORKSPACES_LEASE_TTL_SEC', 900)),
    leaseMaxTtlSec: Math.max(1, num('WORKSPACES_LEASE_MAX_TTL_SEC', 86_400)),
    leaseReconcileSec: num('WORKSPACES_LEASE_RECONCILE_SEC', 60),
    leaseOrphanGraceMs: num('WORKSPACES_LEASE_ORPHAN_GRACE_SEC', 120) * 1000,
  }
}
