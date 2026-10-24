import { createHash, randomBytes } from 'node:crypto'
import {
  appendFileSync,
  createWriteStream,
  mkdirSync,
  readFileSync,
} from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { loadWorkspacesConfig, type WorkspacesConfig } from './config.js'
import { OxenError, type OxenClient } from './oxenClient.js'

export type Progress = {
  phase: 'resolving' | 'listing' | 'downloading' | 'linking' | 'publishing'
  files_done: number
  files_total: number
  bytes_done: number
  bytes_total: number
}

export type ManifestFile = { size: number; sha256: string; oxen_hash: string }

/** In-memory manifest. Maps (not objects) so a file named `__proto__` is harmless. */
export type Manifest = {
  commit: string
  rootHash: string
  files: Map<string, ManifestFile>
  /** directory path ('' = root) → Oxen directory hash */
  dirs: Map<string, string>
}

export type CheckoutMeta = {
  commit: string
  namespace: string
  repo: string
  created_at: string
  last_used_at: string
  built_from: string[]
  files: number
  bytes: number
  new_bytes: number
  downloaded_files: number
  linked_files: number
  pruned_dirs: number
  skipped: { oxen: number; unsupported: number }
  oxen_listing_hash: string
  oxen_size: number | null
  build_ms: number
}

export type CheckoutRef = {
  namespace: string
  repo: string
  commit: string
  dir: string
  tree: string
  reused: boolean
}

export type StoreAuditEvent = {
  action: 'checkout.build' | 'checkout.evict' | 'checkout.corrupt' | 'store.gc' | 'store.full'
  namespace?: string
  repo?: string
  detail: Record<string, unknown>
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'StoreError'
  }
}

export type StoreCtx = {
  cfg?: WorkspacesConfig
  oxen: OxenClient
  audit?: (e: StoreAuditEvent) => void
  /** `ns/repo/commit` keys that must never be evicted (workspaces). */
  refs?: () => Iterable<string>
}

type Build = {
  key: string
  namespace: string
  repo: string
  commit: string
  progress: Progress
  startedAt: number
  promise: Promise<CheckoutRef>
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const COMMIT_RE = /^[A-Za-z0-9_-]{6,128}$/
const HEXISH_RE = /^[0-9a-f]{16,64}$/

export function validNs(s: string): boolean {
  return NAME_RE.test(s) && !s.includes('..')
}
export function validCommit(s: string): boolean {
  return COMMIT_RE.test(s)
}
export const checkoutKey = (ns: string, repo: string, commit: string) => `${ns}/${repo}/${commit}`

export function validateEntryName(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new StoreError(`invalid entry name in listing: ${JSON.stringify(name)}`, 422)
  }
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function manifestFromJson(raw: unknown, commit: string): Manifest {
  const j = raw as {
    commit?: string
    root_hash?: string
    files?: Record<string, ManifestFile>
    dirs?: Record<string, string>
  }
  return {
    commit: j.commit ?? commit,
    rootHash: j.root_hash ?? '',
    files: new Map(Object.entries(j.files ?? {})),
    dirs: new Map(Object.entries(j.dirs ?? {})),
  }
}

export function manifestToJson(m: Manifest): unknown {
  return {
    version: 1,
    commit: m.commit,
    root_hash: m.rootHash,
    files: Object.fromEntries(m.files),
    dirs: Object.fromEntries(m.dirs),
  }
}

export function readManifestFile(path: string, commit: string): Manifest {
  return manifestFromJson(JSON.parse(readFileSync(path, 'utf8')), commit)
}

/** Per-directory index over a manifest so subtree walks never scan every file. */
type DirIndex = { files: Map<string, string[]>; dirs: Map<string, string[]> }

function indexManifest(m: Manifest): DirIndex {
  const files = new Map<string, string[]>()
  const dirs = new Map<string, string[]>()
  const parentOf = (p: string) => {
    const i = p.lastIndexOf('/')
    return i < 0 ? '' : p.slice(0, i)
  }
  for (const p of m.files.keys()) {
    const parent = parentOf(p)
    let l = files.get(parent)
    if (!l) files.set(parent, (l = []))
    l.push(p)
  }
  for (const d of m.dirs.keys()) {
    if (d === '') continue
    const parent = parentOf(d)
    let l = dirs.get(parent)
    if (!l) dirs.set(parent, (l = []))
    l.push(d)
  }
  return { files, dirs }
}

type Candidate = { commit: string; manifest: Manifest; idx: DirIndex }

class Semaphore {
  private waiting: Array<() => void> = []
  private free: number
  constructor(n: number) {
    this.free = n
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free -= 1
    else await new Promise<void>((r) => this.waiting.push(r))
    try {
      return await fn()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.free += 1
    }
  }
}

export class CheckoutStore {
  readonly cfg: WorkspacesConfig
  readonly oxen: OxenClient
  private readonly audit?: StoreCtx['audit']
  private readonly refsFn?: StoreCtx['refs']
  readonly builds = new Map<string, Build>()
  readonly lastErrors = new Map<string, { message: string; status: number; at: string }>()
  private readonly journals = new Map<string, Map<string, { sha: string; size: number }>>()

  constructor(ctx: StoreCtx) {
    this.cfg = ctx.cfg ?? loadWorkspacesConfig()
    this.oxen = ctx.oxen
    this.audit = ctx.audit
    this.refsFn = ctx.refs
  }

  // ── paths ────────────────────────────────────────────────────────────
  get root(): string {
    return this.cfg.storeDir
  }
  blobPath(sha: string): string {
    return join(this.root, 'blobs', sha.slice(0, 2), sha)
  }
  repoDir(ns: string, repo: string): string {
    return join(this.root, 'commits', ns, repo)
  }
  commitDir(ns: string, repo: string, commit: string): string {
    return join(this.repoDir(ns, repo), commit)
  }
  treeDir(ns: string, repo: string, commit: string): string {
    return join(this.commitDir(ns, repo, commit), 'tree')
  }
  referenced(): Set<string> {
    const s = new Set<string>(this.refsFn ? [...this.refsFn()] : [])
    for (const k of this.builds.keys()) s.add(k)
    return s
  }
  emit(e: StoreAuditEvent): void {
    try {
      this.audit?.(e)
    } catch {
      /* audit must never break the store */
    }
  }

  // ── public api ───────────────────────────────────────────────────────
  async init(): Promise<void> {
    for (const d of ['blobs', 'commits', 'tmp', 'index']) {
      await mkdir(join(this.root, d), { recursive: true })
    }
  }

  async isReady(ns: string, repo: string, commit: string): Promise<boolean> {
    try {
      await stat(join(this.commitDir(ns, repo, commit), 'READY'))
      return true
    } catch {
      return false
    }
  }

  async isCorrupt(ns: string, repo: string, commit: string): Promise<boolean> {
    try {
      await stat(join(this.commitDir(ns, repo, commit), 'CORRUPT'))
      return true
    } catch {
      return false
    }
  }

  progressFor(ns: string, repo: string, commit: string): Progress | null {
    return this.builds.get(checkoutKey(ns, repo, commit))?.progress ?? null
  }

  /** Resolve `ref` and return as soon as the commit is known; `done` settles when READY. */
  async startCheckout(
    ns: string,
    repo: string,
    ref: string,
  ): Promise<{ commit: string; done: Promise<CheckoutRef> }> {
    if (!validNs(ns) || !validNs(repo)) throw new StoreError('invalid namespace or repo', 400)
    if (!ref || /[\0\\]/.test(ref) || ref.split('/').some((s) => s === '..')) {
      throw new StoreError('invalid ref', 400)
    }
    let commit = ref
    // A full commit id that is already published needs no Oxen traffic (fast path §3.2).
    if (!(HEXISH_RE.test(ref) && (await this.isReady(ns, repo, ref)))) {
      commit = await this.oxen.resolveCommit(ns, repo, ref)
    }
    if (!validCommit(commit)) throw new StoreError('oxen returned an invalid commit id', 502)
    return { commit, done: this.ensureResolved(ns, repo, commit) }
  }

  async ensureCheckout(ns: string, repo: string, ref: string): Promise<CheckoutRef> {
    const { done } = await this.startCheckout(ns, repo, ref)
    return done
  }

  private ensureResolved(ns: string, repo: string, commit: string): Promise<CheckoutRef> {
    const key = checkoutKey(ns, repo, commit)
    const running = this.builds.get(key)
    if (running) return running.promise

    const progress: Progress = {
      phase: 'resolving',
      files_done: 0,
      files_total: 0,
      bytes_done: 0,
      bytes_total: 0,
    }
    const build: Build = {
      key,
      namespace: ns,
      repo,
      commit,
      progress,
      startedAt: Date.now(),
      promise: undefined as unknown as Promise<CheckoutRef>,
    }
    build.promise = (async () => {
      try {
        const fast = await this.fastPath(ns, repo, commit)
        if (fast) return fast
        let ref: CheckoutRef
        try {
          ref = await this.buildCheckout(build)
        } catch (err) {
          if (errCode(err) !== 'ENOSPC') throw err
          // Disk full: free what we can once, then report 507.
          const { runGc } = await import('./checkoutMaintenance.js')
          await runGc(this, { reason: 'enospc' }).catch(() => undefined)
          try {
            ref = await this.buildCheckout(build)
          } catch (err2) {
            if (errCode(err2) === 'ENOSPC') {
              this.emit({ action: 'store.full', namespace: ns, repo, detail: { commit } })
              throw new StoreError('checkout store is out of disk space', 507)
            }
            throw err2
          }
        }
        this.lastErrors.delete(key)
        return ref
      } catch (err) {
        const status = err instanceof StoreError || err instanceof OxenError ? err.status : 500
        this.lastErrors.set(key, {
          message: err instanceof Error ? err.message : String(err),
          status,
          at: new Date().toISOString(),
        })
        throw err
      } finally {
        this.builds.delete(key)
      }
    })()
    // Callers may attach late; never let an unobserved build crash the process.
    build.promise.catch(() => undefined)
    this.builds.set(key, build)
    return build.promise
  }

  private async fastPath(ns: string, repo: string, commit: string): Promise<CheckoutRef | null> {
    const dir = this.commitDir(ns, repo, commit)
    if (!(await this.isReady(ns, repo, commit))) return null
    if (await this.isCorrupt(ns, repo, commit)) return null
    const now = new Date()
    await utimes(join(dir, 'READY'), now, now).catch(() => undefined)
    return { namespace: ns, repo, commit, dir, tree: join(dir, 'tree'), reused: true }
  }

  async loadManifest(ns: string, repo: string, commit: string): Promise<Manifest> {
    const raw = await readFile(join(this.commitDir(ns, repo, commit), 'manifest.json'), 'utf8')
    return manifestFromJson(JSON.parse(raw), commit)
  }

  // ── known-blob journal (durable oxen_hash → sha256, enables resume) ──
  private journalPath(ns: string, repo: string): string {
    return join(this.root, 'index', ns, `${repo}.tsv`)
  }

  private journal(ns: string, repo: string): Map<string, { sha: string; size: number }> {
    const k = `${ns}/${repo}`
    let m = this.journals.get(k)
    if (m) return m
    m = new Map()
    try {
      for (const line of readFileSync(this.journalPath(ns, repo), 'utf8').split('\n')) {
        const [oxen, sha, size] = line.split('\t')
        if (oxen && sha && /^[0-9a-f]{64}$/.test(sha)) m.set(oxen, { sha, size: Number(size) })
      }
    } catch {
      /* none yet */
    }
    this.journals.set(k, m)
    return m
  }

  private journalAdd(ns: string, repo: string, oxen: string, sha: string, size: number): void {
    if (!oxen) return
    const m = this.journal(ns, repo)
    if (m.has(oxen)) return
    m.set(oxen, { sha, size })
    try {
      mkdirSync(dirname(this.journalPath(ns, repo)), { recursive: true })
      appendFileSync(this.journalPath(ns, repo), `${oxen}\t${sha}\t${size}\n`)
    } catch {
      /* index is an optimisation only */
    }
  }

  async listReadyCommits(ns: string, repo: string): Promise<Array<{ commit: string; usedAt: number }>> {
    let names: string[]
    try {
      names = await readdir(this.repoDir(ns, repo))
    } catch {
      return []
    }
    const out: Array<{ commit: string; usedAt: number }> = []
    for (const c of names) {
      try {
        const st = await stat(join(this.repoDir(ns, repo), c, 'READY'))
        out.push({ commit: c, usedAt: st.mtimeMs })
      } catch {
        /* not published */
      }
    }
    return out.sort((a, b) => b.usedAt - a.usedAt)
  }

  private async loadCandidates(ns: string, repo: string, exclude: string): Promise<Candidate[]> {
    const out: Candidate[] = []
    for (const { commit } of await this.listReadyCommits(ns, repo)) {
      if (commit === exclude || (await this.isCorrupt(ns, repo, commit))) continue
      try {
        const manifest = await this.loadManifest(ns, repo, commit)
        out.push({ commit, manifest, idx: indexManifest(manifest) })
      } catch {
        continue
      }
      if (out.length >= 5) break
    }
    return out
  }

  // ── linking helpers ──────────────────────────────────────────────────
  /** Link blob → dest. false = blob missing (caller re-downloads). */
  private async linkBlob(sha: string, dest: string, made: Set<string>): Promise<boolean> {
    const parent = dirname(dest)
    if (!made.has(parent)) {
      await mkdir(parent, { recursive: true })
      made.add(parent)
    }
    const src = this.blobPath(sha)
    for (let i = 0; i < 2; i += 1) {
      try {
        await link(src, dest)
        return true
      } catch (err) {
        const code = errCode(err)
        if (code === 'ENOENT') {
          // Either the blob was collected or the parent vanished; only the former is "missing".
          try {
            await lstat(src)
          } catch {
            return false
          }
          await mkdir(parent, { recursive: true })
          continue
        }
        if (code === 'EEXIST') {
          await unlink(dest)
          continue
        }
        if (code === 'EMLINK') {
          await copyFile(src, dest)
          return true
        }
        throw err
      }
    }
    return false
  }

  // ── build ────────────────────────────────────────────────────────────
  private async buildCheckout(build: Build): Promise<CheckoutRef> {
    const { namespace: ns, repo, commit, progress } = build
    const t0 = Date.now()
    await this.init()
    const buildId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
    const tmp = join(this.root, 'tmp', buildId)
    const tree = join(tmp, 'tree')
    await mkdir(tree, { recursive: true })
    await mkdir(join(tmp, '.part'), { recursive: true })
    const lockPath = join(tmp, 'lock')
    const writeLock = () =>
      writeFile(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now(), key: build.key })).catch(
        () => undefined,
      )
    await writeLock()
    const beat = setInterval(() => void writeLock(), 10_000)
    beat.unref()

    let keepTmp = false
    try {
      const candidates = await this.loadCandidates(ns, repo, commit)
      const known = new Map<string, { sha: string; size: number }>(this.journal(ns, repo))
      for (const c of candidates) {
        for (const f of c.manifest.files.values()) {
          if (f.oxen_hash && !known.has(f.oxen_hash)) known.set(f.oxen_hash, { sha: f.sha256, size: f.size })
        }
      }

      const files = new Map<string, ManifestFile>()
      const dirs = new Map<string, string>()
      const queue: Array<{ path: string; size: number; oxen: string }> = []
      const made = new Set<string>()
      const stats = { linked: 0, downloaded: 0, newBytes: 0, pruned: 0, skippedOxen: 0, skippedOther: 0 }
      const listSem = new Semaphore(this.cfg.listConcurrency)
      progress.phase = 'listing'
      let rootHash = ''
      let oxenSize: number | null = null

      const addFile = (path: string, f: ManifestFile) => {
        files.set(path, f)
        progress.files_done += 1
        progress.bytes_done += f.size
      }

      const pruneFrom = async (cand: Candidate, dirPath: string): Promise<boolean> => {
        const addedFiles: Array<[string, ManifestFile]> = []
        const addedDirs: Array<[string, string]> = []
        const walk = async (d: string): Promise<boolean> => {
          addedDirs.push([d, cand.manifest.dirs.get(d) ?? ''])
          for (const p of cand.idx.files.get(d) ?? []) {
            const f = cand.manifest.files.get(p)!
            if (!(await this.linkBlob(f.sha256, join(tree, p), made))) return false
            addedFiles.push([p, f])
          }
          for (const sub of cand.idx.dirs.get(d) ?? []) if (!(await walk(sub))) return false
          return true
        }
        if (await walk(dirPath)) {
          for (const [p, f] of addedFiles) {
            progress.files_total += 1
            progress.bytes_total += f.size
            addFile(p, f)
          }
          for (const [d, h] of addedDirs) dirs.set(d, h)
          stats.linked += addedFiles.length
          stats.pruned += 1
          return true
        }
        await rm(join(tree, dirPath), { recursive: true, force: true })
        for (const d of made) if (d === join(tree, dirPath) || d.startsWith(join(tree, dirPath) + sep)) made.delete(d)
        return false
      }

      const walkDir = async (dirPath: string): Promise<void> => {
        const listing = await listSem.run(() => this.oxen.listDir(ns, repo, commit, dirPath))
        if (dirPath === '') {
          rootHash = listing.hash
          oxenSize = listing.size
        }
        dirs.set(dirPath, listing.hash)
        const children: string[] = []
        for (const e of listing.entries) {
          validateEntryName(e.name)
          if (e.name === '.oxen') {
            stats.skippedOxen += 1
            continue
          }
          if (e.dataType === 'symlink') {
            stats.skippedOther += 1
            continue
          }
          const rel = dirPath ? `${dirPath}/${e.name}` : e.name
          if (!resolve(tree, rel).startsWith(tree + sep)) {
            throw new StoreError(`entry escapes tree: ${rel}`, 422)
          }
          if (e.isDir) {
            if (e.hash) {
              let pruned = false
              for (const cand of candidates) {
                if (cand.manifest.dirs.get(rel) === e.hash && (await pruneFrom(cand, rel))) {
                  pruned = true
                  break
                }
              }
              if (pruned) continue
            }
            await mkdir(join(tree, rel), { recursive: true })
            made.add(join(tree, rel))
            children.push(rel)
            continue
          }
          progress.files_total += 1
          progress.bytes_total += e.size
          const hit = e.hash ? known.get(e.hash) : undefined
          if (hit && (await this.linkBlob(hit.sha, join(tree, rel), made))) {
            stats.linked += 1
            addFile(rel, { size: e.size, sha256: hit.sha, oxen_hash: e.hash })
          } else {
            queue.push({ path: rel, size: e.size, oxen: e.hash })
          }
        }
        await Promise.all(children.map((c) => walkDir(c)))
      }
      await walkDir('')

      // Download whatever is still missing; each completed blob is durable at once.
      progress.phase = 'downloading'
      let failed: unknown = null
      let nextIdx = 0
      const workers = Array.from({ length: Math.min(this.cfg.downloadConcurrency, queue.length) }, async (_, w) => {
        let n = 0
        while (!failed) {
          const item = queue[nextIdx++]
          if (!item) return
          try {
            const sha = await this.fetchFile(ns, repo, commit, item, tmp, `${w}-${n++}`, known, tree, made)
            if (sha.downloaded) {
              stats.downloaded += 1
              stats.newBytes += sha.newBytes
            } else stats.linked += 1
            addFile(item.path, { size: item.size, sha256: sha.sha, oxen_hash: item.oxen })
          } catch (err) {
            failed ??= err
          }
        }
      })
      await Promise.all(workers)
      if (failed) throw failed

      progress.phase = 'publishing'
      keepTmp = true // validation failures keep tmp for inspection
      const bytes = [...files.values()].reduce((a, f) => a + f.size, 0)
      await this.validate(tree, files)
      if (files.size !== progress.files_total || bytes !== progress.bytes_total) {
        throw new StoreError(
          `validation: expected ${progress.files_total} files / ${progress.bytes_total} bytes, got ${files.size} / ${bytes}`,
          500,
        )
      }
      keepTmp = false

      const manifest: Manifest = { commit, rootHash, files, dirs }
      const meta: CheckoutMeta = {
        commit,
        namespace: ns,
        repo,
        created_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
        built_from: candidates.map((c) => c.commit),
        files: files.size,
        bytes,
        new_bytes: stats.newBytes,
        downloaded_files: stats.downloaded,
        linked_files: stats.linked,
        pruned_dirs: stats.pruned,
        skipped: { oxen: stats.skippedOxen, unsupported: stats.skippedOther },
        oxen_listing_hash: rootHash,
        oxen_size: oxenSize,
        build_ms: Date.now() - t0,
      }
      clearInterval(beat)
      await rm(join(tmp, '.part'), { recursive: true, force: true })
      await rm(lockPath, { force: true })
      await writeFile(join(tmp, 'manifest.json'), JSON.stringify(manifestToJson(manifest)))
      await writeFile(join(tmp, 'meta.json'), JSON.stringify(meta, null, 2))
      await writeFile(join(tmp, 'READY'), `${new Date().toISOString()}\n`)
      await this.fsyncDir(tmp)
      const dest = this.commitDir(ns, repo, commit)
      await mkdir(dirname(dest), { recursive: true })
      let reused = false
      try {
        // A corrupt predecessor is quarantined first so the rename can take its place.
        if (await this.isCorrupt(ns, repo, commit)) {
          const { quarantineCheckout } = await import('./checkoutMaintenance.js')
          await quarantineCheckout(this, ns, repo, commit)
        }
        await rename(tmp, dest)
      } catch (err) {
        const code = errCode(err)
        if ((code === 'ENOTEMPTY' || code === 'EEXIST') && (await this.isReady(ns, repo, commit))) {
          await rm(tmp, { recursive: true, force: true })
          reused = true
        } else throw err
      }
      await this.fsyncDir(dirname(dest))
      if (!reused) {
        this.emit({
          action: 'checkout.build',
          namespace: ns,
          repo,
          detail: {
            commit,
            files: meta.files,
            bytes: meta.bytes,
            new_bytes: meta.new_bytes,
            downloaded_files: meta.downloaded_files,
            linked_files: meta.linked_files,
            build_ms: meta.build_ms,
          },
        })
      }
      return { namespace: ns, repo, commit, dir: dest, tree: join(dest, 'tree'), reused }
    } catch (err) {
      clearInterval(beat)
      if (!keepTmp) await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      else await writeFile(join(tmp, 'FAILED'), String(err)).catch(() => undefined)
      throw err
    } finally {
      clearInterval(beat)
    }
  }

  private async fsyncDir(dir: string): Promise<void> {
    try {
      const fh = await open(dir, 'r')
      try {
        await fh.sync()
      } finally {
        await fh.close()
      }
    } catch {
      /* best effort (some filesystems refuse directory fsync) */
    }
  }

  private async fetchFile(
    ns: string,
    repo: string,
    commit: string,
    item: { path: string; size: number; oxen: string },
    tmp: string,
    partId: string,
    known: Map<string, { sha: string; size: number }>,
    tree: string,
    made: Set<string>,
  ): Promise<{ sha: string; downloaded: boolean; newBytes: number }> {
    // An identical file may have been fetched by another worker meanwhile.
    const hit = item.oxen ? known.get(item.oxen) : undefined
    if (hit && (await this.linkBlob(hit.sha, join(tree, item.path), made))) {
      return { sha: hit.sha, downloaded: false, newBytes: 0 }
    }
    const part = join(tmp, '.part', partId)
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.cfg.downloadRetries; attempt += 1) {
      try {
        const stream = await this.oxen.openFile(ns, repo, commit, item.path)
        const hash = createHash('sha256')
        let size = 0
        await pipeline(
          stream,
          new Transform({
            transform(chunk: Buffer, _enc, cb) {
              hash.update(chunk)
              size += chunk.length
              cb(null, chunk)
            },
          }),
          createWriteStream(part, { mode: 0o644 }),
        )
        if (size !== item.size) {
          throw new OxenError(`size mismatch for ${item.path}: listing ${item.size}, got ${size}`, 502, true)
        }
        const sha = hash.digest('hex')
        const dest = this.blobPath(sha)
        await mkdir(dirname(dest), { recursive: true })
        let isNew = true
        try {
          await lstat(dest)
          isNew = false
          await unlink(part)
        } catch (e) {
          if (errCode(e) !== 'ENOENT') throw e
          await rename(part, dest)
        }
        this.journalAdd(ns, repo, item.oxen, sha, size)
        if (item.oxen) known.set(item.oxen, { sha, size })
        if (!(await this.linkBlob(sha, join(tree, item.path), made))) {
          throw new StoreError(`blob vanished while linking ${item.path}`, 500, true)
        }
        return { sha, downloaded: true, newBytes: isNew ? size : 0 }
      } catch (err) {
        lastErr = err
        await unlink(part).catch(() => undefined)
        if (errCode(err) === 'ENOSPC') throw err
        if (err instanceof OxenError && !err.retryable) throw err
        if (err instanceof StoreError && !err.retryable) throw err
        if (attempt < this.cfg.downloadRetries) await sleep(this.cfg.downloadRetryBaseMs * 2 ** attempt)
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  /** Every file on disk matches the manifest; nothing foreign, nothing missing. */
  private async validate(tree: string, files: Map<string, ManifestFile>): Promise<void> {
    let count = 0
    const walk = async (abs: string, rel: string): Promise<void> => {
      for (const e of await readdir(abs, { withFileTypes: true })) {
        validateEntryName(e.name)
        if (e.name === '.oxen') throw new StoreError('validation: .oxen present in tree', 422)
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(join(abs, e.name), r)
        else if (e.isFile()) {
          const m = files.get(r)
          const st = await lstat(join(abs, e.name))
          if (!m || m.size !== st.size) throw new StoreError(`validation: ${r} does not match manifest`, 500)
          count += 1
        } else throw new StoreError(`validation: unexpected entry ${r}`, 500)
      }
    }
    await walk(tree, '')
    if (count !== files.size) throw new StoreError(`validation: tree has ${count} files, manifest ${files.size}`, 500)
  }
}

let singleton: CheckoutStore | null = null

export function getCheckoutStore(): CheckoutStore | null {
  return singleton
}

export function setCheckoutStore(s: CheckoutStore | null): void {
  singleton = s
}
