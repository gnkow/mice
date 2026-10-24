import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { checkoutKey, type CheckoutMeta, type CheckoutStore, type Progress } from './checkout.js'

export type CheckoutInfo = {
  namespace: string
  repo: string
  commit: string
  status: 'ready' | 'corrupt'
  files: number
  bytes: number
  new_bytes: number
  created_at: string
  last_used_at: string
  referenced: boolean
}

export type CheckoutStatus = {
  namespace: string
  repo: string
  commit: string
  status: 'ready' | 'building' | 'corrupt' | 'failed' | 'missing'
  progress: Progress | null
  last_error: string | null
  checkout: CheckoutInfo | null
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function readInfo(
  store: CheckoutStore,
  ns: string,
  repo: string,
  commit: string,
  refs: Set<string>,
): Promise<CheckoutInfo | null> {
  const dir = store.commitDir(ns, repo, commit)
  let ready
  try {
    ready = await stat(join(dir, 'READY'))
  } catch {
    return null
  }
  let meta: Partial<CheckoutMeta> = {}
  try {
    meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as CheckoutMeta
  } catch {
    /* listing still works without meta */
  }
  const corrupt = await store.isCorrupt(ns, repo, commit)
  return {
    namespace: ns,
    repo,
    commit,
    status: corrupt ? 'corrupt' : 'ready',
    files: meta.files ?? 0,
    bytes: meta.bytes ?? 0,
    new_bytes: meta.new_bytes ?? 0,
    created_at: meta.created_at ?? ready.birthtime.toISOString(),
    last_used_at: new Date(ready.mtimeMs).toISOString(),
    referenced: refs.has(checkoutKey(ns, repo, commit)),
  }
}

export async function listCheckouts(
  store: CheckoutStore,
  filter?: { namespace?: string; repo?: string },
): Promise<CheckoutInfo[]> {
  const refs = store.referenced()
  const out: CheckoutInfo[] = []
  const root = join(store.root, 'commits')
  for (const ns of filter?.namespace ? [filter.namespace] : await subdirs(root)) {
    for (const repo of filter?.repo ? [filter.repo] : await subdirs(join(root, ns))) {
      for (const commit of await subdirs(join(root, ns, repo))) {
        const info = await readInfo(store, ns, repo, commit, refs)
        if (info) out.push(info)
      }
    }
  }
  return out.sort((a, b) => b.last_used_at.localeCompare(a.last_used_at))
}

export async function checkoutStatus(
  store: CheckoutStore,
  ns: string,
  repo: string,
  commit: string,
): Promise<CheckoutStatus> {
  const key = checkoutKey(ns, repo, commit)
  const base = { namespace: ns, repo, commit }
  const build = store.builds.get(key)
  if (build) {
    return { ...base, status: 'building', progress: { ...build.progress }, last_error: null, checkout: null }
  }
  const info = await readInfo(store, ns, repo, commit, store.referenced())
  if (info) {
    return { ...base, status: info.status, progress: null, last_error: null, checkout: info }
  }
  const err = store.lastErrors.get(key)
  if (err) return { ...base, status: 'failed', progress: null, last_error: err.message, checkout: null }
  return { ...base, status: 'missing', progress: null, last_error: null, checkout: null }
}

async function trash(store: CheckoutStore, dir: string, label: string): Promise<void> {
  const dest = join(store.root, 'tmp', 'trash', `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
  await mkdir(join(store.root, 'tmp', 'trash'), { recursive: true })
  await rename(dir, dest)
  await rm(dest, { recursive: true, force: true })
}

/** Corrupt checkouts are moved aside (not deleted) so live mounts keep their inodes. */
export async function quarantineCheckout(
  store: CheckoutStore,
  ns: string,
  repo: string,
  commit: string,
): Promise<void> {
  const dest = join(store.root, 'tmp', 'quarantine', `${ns}__${repo}__${commit}__${Date.now().toString(36)}`)
  await mkdir(join(store.root, 'tmp', 'quarantine'), { recursive: true })
  await rename(store.commitDir(ns, repo, commit), dest)
}

export async function evictCheckout(
  store: CheckoutStore,
  ns: string,
  repo: string,
  commit: string,
): Promise<'evicted' | 'referenced' | 'missing'> {
  if (store.referenced().has(checkoutKey(ns, repo, commit))) return 'referenced'
  if (!(await store.isReady(ns, repo, commit))) return 'missing'
  await trash(store, store.commitDir(ns, repo, commit), 'evict')
  return 'evicted'
}

export type GcReport = {
  reason: string
  evicted: string[]
  blobs_deleted: number
  bytes_freed: number
  store_bytes: number
  blob_count: number
  over_watermark: boolean
  swept_tmp: number
}

type BlobRow = { path: string; size: number; nlink: number; mtimeMs: number }

async function allBlobs(store: CheckoutStore): Promise<BlobRow[]> {
  const out: BlobRow[] = []
  const root = join(store.root, 'blobs')
  for (const aa of await subdirs(root)) {
    if (!/^[0-9a-f]{2}$/.test(aa)) continue
    for (const name of await readdir(join(root, aa))) {
      const p = join(root, aa, name)
      try {
        const st = await stat(p)
        if (st.isFile()) out.push({ path: p, size: st.size, nlink: st.nlink, mtimeMs: st.mtimeMs })
      } catch {
        /* raced with a delete */
      }
    }
  }
  return out
}

const gcRuns = new WeakMap<CheckoutStore, Promise<GcReport>>()

export function runGc(store: CheckoutStore, opts: { reason?: string; now?: number } = {}): Promise<GcReport> {
  const running = gcRuns.get(store)
  if (running) return running
  const p = doGc(store, opts).finally(() => gcRuns.delete(store))
  gcRuns.set(store, p)
  return p
}

async function doGc(store: CheckoutStore, opts: { reason?: string; now?: number }): Promise<GcReport> {
  const cfg = store.cfg
  const now = opts.now ?? Date.now()
  const report: GcReport = {
    reason: opts.reason ?? 'manual',
    evicted: [],
    blobs_deleted: 0,
    bytes_freed: 0,
    store_bytes: 0,
    blob_count: 0,
    over_watermark: false,
    swept_tmp: 0,
  }
  const evict = async (c: CheckoutInfo) => {
    if ((await evictCheckout(store, c.namespace, c.repo, c.commit)) === 'evicted') {
      const key = checkoutKey(c.namespace, c.repo, c.commit)
      report.evicted.push(key)
      store.emit({
        action: 'checkout.evict',
        namespace: c.namespace,
        repo: c.repo,
        detail: { commit: c.commit, reason: report.reason, files: c.files, bytes: c.bytes },
      })
    }
  }

  // 1. keep-N + TTL policy over unreferenced checkouts, per repo.
  const all = await listCheckouts(store)
  const byRepo = new Map<string, CheckoutInfo[]>()
  for (const c of all) {
    const k = `${c.namespace}/${c.repo}`
    byRepo.set(k, [...(byRepo.get(k) ?? []), c])
  }
  const ttlMs = cfg.ttlDays * 86_400_000
  for (const list of byRepo.values()) {
    const unref = list.filter((c) => !c.referenced) // already newest first
    for (const [i, c] of unref.entries()) {
      const age = now - Date.parse(c.last_used_at)
      if (c.status === 'corrupt' || (i >= cfg.keepPerRepo && age > ttlMs)) await evict(c)
    }
  }

  // 2. blobs only the store references.
  const sweepBlobs = async (): Promise<BlobRow[]> => {
    const kept: BlobRow[] = []
    for (const b of await allBlobs(store)) {
      if (b.nlink === 1 && now - b.mtimeMs >= cfg.blobMinAgeMs) {
        try {
          await unlink(b.path)
          report.blobs_deleted += 1
          report.bytes_freed += b.size
          continue
        } catch {
          /* already gone */
        }
      }
      kept.push(b)
    }
    return kept
  }
  let blobs = await sweepBlobs()
  let total = blobs.reduce((a, b) => a + b.size, 0)

  // 3. high-water mark: LRU-evict unreferenced checkouts down to 90 %.
  if (cfg.storeMaxBytes && total > cfg.storeMaxBytes) {
    const lru = (await listCheckouts(store)).filter((c) => !c.referenced).reverse()
    for (const c of lru) {
      if (total <= cfg.storeMaxBytes * 0.9) break
      await evict(c)
      blobs = await sweepBlobs()
      total = blobs.reduce((a, b) => a + b.size, 0)
    }
    if (total > cfg.storeMaxBytes) {
      report.over_watermark = true
      store.emit({ action: 'store.full', detail: { store_bytes: total, max_bytes: cfg.storeMaxBytes } })
    }
  }
  report.store_bytes = total
  report.blob_count = blobs.length
  report.swept_tmp = await sweepTmp(store, now)
  return report
}

/** Remove stale builds, old failed builds, trash and old quarantined checkouts. */
export async function sweepTmp(store: CheckoutStore, now = Date.now()): Promise<number> {
  const cfg = store.cfg
  const tmpRoot = join(store.root, 'tmp')
  let removed = 0
  for (const name of await readdir(tmpRoot).catch(() => [] as string[])) {
    const dir = join(tmpRoot, name)
    if (name === 'trash') {
      for (const t of await readdir(dir).catch(() => [] as string[])) {
        await rm(join(dir, t), { recursive: true, force: true })
        removed += 1
      }
      continue
    }
    if (name === 'quarantine') {
      for (const q of await readdir(dir).catch(() => [] as string[])) {
        const st = await stat(join(dir, q)).catch(() => null)
        if (st && now - st.mtimeMs > cfg.tmpKeepMs) {
          await rm(join(dir, q), { recursive: true, force: true })
          removed += 1
        }
      }
      continue
    }
    const st = await stat(dir).catch(() => null)
    if (!st?.isDirectory()) continue
    const lock = await stat(join(dir, 'lock')).catch(() => null)
    const failed = await stat(join(dir, 'FAILED')).catch(() => null)
    if (lock && now - lock.mtimeMs < cfg.lockStaleMs) continue
    let stale: boolean
    if (failed) stale = now - failed.mtimeMs > cfg.tmpKeepMs
    else if (lock) stale = now - lock.mtimeMs > cfg.lockStaleMs
    else stale = now - st.mtimeMs > cfg.lockStaleMs
    if (stale) {
      await rm(dir, { recursive: true, force: true })
      removed += 1
    }
  }
  return removed
}

export type ScrubReport = { checked: number; total: number; bad: string[]; corrupt: string[] }

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256')
  await pipeline(createReadStream(path), h)
  return h.digest('hex')
}

/** Re-hash a rotating fraction (or all) of the blobs; quarantine mismatches. */
export async function runScrub(
  store: CheckoutStore,
  opts: { fraction?: number; all?: boolean } = {},
): Promise<ScrubReport> {
  const blobs = (await allBlobs(store)).sort((a, b) => (a.path < b.path ? -1 : 1))
  const cursorPath = join(store.root, 'scrub.json')
  let cursor = 0
  try {
    cursor = (JSON.parse(await readFile(cursorPath, 'utf8')) as { cursor: number }).cursor
  } catch {
    /* first run */
  }
  const total = blobs.length
  const n = opts.all ? total : Math.min(total, Math.max(1, Math.ceil(total * (opts.fraction ?? store.cfg.scrubFraction))))
  const bad: string[] = []
  for (let i = 0; i < n; i += 1) {
    const b = blobs[(cursor + i) % total]
    if (!b) break
    const sha = b.path.slice(b.path.lastIndexOf('/') + 1)
    let actual: string | null = null
    try {
      actual = await sha256File(b.path)
    } catch {
      /* unreadable counts as bad */
    }
    if (actual !== sha) {
      bad.push(sha)
      await mkdir(join(store.root, 'blobs', '.bad'), { recursive: true })
      await rename(b.path, join(store.root, 'blobs', '.bad', `${sha}.${Date.now()}`)).catch(() => undefined)
    }
  }
  await writeFile(cursorPath, JSON.stringify({ cursor: total ? (cursor + n) % total : 0 })).catch(() => undefined)

  const corrupt: string[] = []
  if (bad.length) {
    const badSet = new Set(bad)
    for (const c of await listCheckouts(store)) {
      if (c.status === 'corrupt') continue
      const m = await store.loadManifest(c.namespace, c.repo, c.commit).catch(() => null)
      if (!m) continue
      for (const f of m.files.values()) {
        if (badSet.has(f.sha256)) {
          await writeFile(join(store.commitDir(c.namespace, c.repo, c.commit), 'CORRUPT'), JSON.stringify({ sha256: f.sha256, at: new Date().toISOString() }))
          corrupt.push(checkoutKey(c.namespace, c.repo, c.commit))
          store.emit({
            action: 'checkout.corrupt',
            namespace: c.namespace,
            repo: c.repo,
            detail: { commit: c.commit, sha256: f.sha256 },
          })
          break
        }
      }
    }
  }
  return { checked: n, total, bad, corrupt }
}
