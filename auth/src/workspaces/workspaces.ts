import { randomBytes } from 'node:crypto'
import { chmod, chown, cp, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { validWorkspaceId } from './ids.js'
import { getJob } from '../jobsStore.js'
import { createDiskDocument } from '../diskStore.js'
import { getSessionRecord, listSessions } from '../sessionsStore.js'
import { cachedCapabilities, getCapabilities, type Driver } from './capabilities.js'
import {
  checkoutKey,
  StoreError,
  validNs,
  type CheckoutStore,
  type Manifest,
  type Progress,
} from './checkout.js'
import { loadWorkspacesConfig, type WorkspacesConfig } from './config.js'
import {
  cleanRelPath,
  effectiveListDir,
  effectivePaths,
  openInside,
  PathError,
  tarStream,
  type DirEntryOut,
  type OpenedFile,
} from './files.js'
import { LeaseStore, upperHashOf, toPublicLease, LeaseError, type AcquireInput, type Lease, type LeaseHolder, type LeasePublic, type LeaseWorkspaceView } from './leases.js'
import { DockerInUseError, realDocker, type DockerOps } from './mount.js'
import { OxenError } from './oxenClient.js'
import {
  BaseIndex,
  scanTree,
  scanUpper,
  type BaseFile,
  type Changes,
  type MarkerReader,
  type ScanResult,
} from './scan.js'

export type WorkspaceStatus = 'preparing' | 'ready' | 'error'

export type WorkspaceState = {
  id: string
  kind: 'user' | 'auto'
  name: string
  generated_name?: boolean
  namespace: string
  repo: string
  branch: string | null
  source: { branch: string } | { commit: string }
  base_commit: string | null
  lower_commit: string | null
  gen: number
  status: WorkspaceStatus
  op: 'idle'
  op_id: string | null
  quota_bytes: number
  driver: Driver
  last_error: string | null
  retry_count: number
  next_retry_at: string | null
  last_scan: { upper_bytes: number; added: number; modified: number; removed: number; files: number; at: string } | null
  created_by: string
  created_by_sub: string
  created_at: string
  updated_at: string
}

export type WorkspacePublic = {
  id: string
  kind: 'user' | 'auto'
  name: string
  namespace: string
  repo: string
  branch: string | null
  base_commit: string | null
  lower_commit: string | null
  status: WorkspaceStatus
  op: 'idle'
  last_error: string | null
  progress: Progress | null
  upper_bytes: number
  change_counts: { added: number; modified: number; removed: number }
  quota_bytes: number
  driver: Driver
  behind: boolean
  over_quota: boolean
  leases: LeasePublic[]
  writer: LeaseHolder | null
  /** Distinct sessions holding a lease (starting or running). */
  session_count: number
  /** Modes a new mount could actually get right now (`['ro']` while a writer exists or over quota). */
  mountable_modes: Array<'ro' | 'rw'>
  next_retry_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export type CreateInput = {
  namespace: string
  repo: string
  name?: string
  kind?: 'user' | 'auto'
  source: { branch: string } | { commit: string }
  createdBy: { email: string; sub: string }
}

const NAME_RE = /^[\w][\w .@+-]{0,63}$/u

function generatedName(id: string, branch: string | null, commit?: string): string {
  const source = (branch ?? 'commit').replace(/[^\w.@+-]/gu, '-').slice(0, 42)
  return `${id}-${source}${commit ? `-${commit.slice(0, 8)}` : ''}`
}

export function newWorkspaceId(): string {
  return `w_${Array.from(randomBytes(10), (b) => (b % 36).toString(36)).join('')}`
}

export { validWorkspaceId }

export type ServiceOpts = {
  store: CheckoutStore
  cfg?: WorkspacesConfig
  /** Driver for new workspaces; default = capability probe result. */
  pickDriver?: () => Promise<Driver>
  readMarkers?: MarkerReader
  now?: () => number
  docker?: DockerOps
  /** Called for releases the service performs on its own (reconciliation). */
  onLeaseEvent?: (e: { action: 'workspace.lease.release'; namespace: string; repo: string; detail: Record<string, unknown> }) => void
  /** Holder liveness (jobs/sessions stores); default reads them read-only. */
  holderState?: (h: LeaseHolder) => 'alive' | 'gone' | 'unknown' | Promise<'alive' | 'gone' | 'unknown'>
}

type ScanCache = { at: number; result: ScanResult }

export class WorkspaceService {
  readonly cfg: WorkspacesConfig
  readonly store: CheckoutStore
  private readonly states = new Map<string, WorkspaceState>()
  private readonly running = new Set<string>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly scans = new Map<string, ScanCache>()
  private readonly bases = new Map<string, BaseIndex>()
  private readonly heads = new Map<string, { commit: string; at: number }>()
  private readonly pickDriver: () => Promise<Driver>
  private readonly readMarkers?: MarkerReader
  private readonly now: () => number
  readonly docker: DockerOps
  readonly leases: LeaseStore
  private readonly onLeaseEvent?: ServiceOpts['onLeaseEvent']
  private readonly holderStateFn: NonNullable<ServiceOpts['holderState']>
  private reconcileTimer: NodeJS.Timeout | null = null

  constructor(opts: ServiceOpts) {
    this.store = opts.store
    this.cfg = opts.cfg ?? opts.store.cfg
    this.docker = opts.docker ?? realDocker()
    this.onLeaseEvent = opts.onLeaseEvent
    this.holderStateFn = opts.holderState ?? defaultHolderState
    this.leases = new LeaseStore(join(this.cfg.wsDir, '.leases.json'), this.cfg, opts.now)
    this.readMarkers = opts.readMarkers
    this.now = opts.now ?? Date.now
    this.pickDriver =
      opts.pickDriver ??
      (async () => (cachedCapabilities() ?? (await getCapabilities())).driver)
  }

  // ── paths ──────────────────────────────────────────────────────────
  dir(id: string): string {
    return join(this.cfg.wsDir, id)
  }
  private stateDoc(id: string) {
    return createDiskDocument<WorkspaceState>(join(this.dir(id), 'state.json'))
  }
  private baseDoc(id: string) {
    return createDiskDocument<{ files: Record<string, BaseFile> }>(join(this.dir(id), 'base.json'))
  }

  // ── lifecycle ──────────────────────────────────────────────────────
  async init(): Promise<void> {
    await mkdir(this.cfg.wsDir, { recursive: true })
    for (const e of await readdir(this.cfg.wsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || !validWorkspaceId(e.name)) continue
      // An unreadable state file is an incomplete create: ignored, left for inspection.
      const st = this.stateDoc(e.name).read()
      if (st?.id === e.name) this.states.set(st.id, st)
    }
    for (const st of this.states.values()) {
      if (st.status === 'preparing') this.kick(st.id, 0)
    }
    await this.reconcileLeases()
    if (this.cfg.leaseReconcileSec > 0) {
      this.reconcileTimer = setInterval(() => void this.reconcileLeases().catch(() => undefined), this.cfg.leaseReconcileSec * 1000)
      this.reconcileTimer.unref()
    }
  }

  /** §6.1: release expired leases and leases of vanished workspaces / terminal holders. */
  async reconcileLeases(): Promise<number> {
    const released = await this.leases.reconcile({
      workspaceExists: (id) => this.states.has(id),
      holderState: this.holderStateFn,
    })
    for (const { lease, reason } of released) {
      const ws = this.states.get(lease.workspace_id)
      if (!ws) continue
      this.onLeaseEvent?.({
        action: 'workspace.lease.release',
        namespace: ws.namespace,
        repo: ws.repo,
        detail: { workspace_id: ws.id, lease_id: lease.id, mode: lease.mode, holder: lease.holder, reason },
      })
    }
    return released.length
  }

  /** Stop retry timers (tests, shutdown). */
  shutdown(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    this.reconcileTimer = null
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  /** `ns/repo/commit` keys that GC must keep (§3.7). */
  referencedCheckouts(): Set<string> {
    const s = new Set<string>()
    for (const w of this.states.values()) {
      for (const c of [w.base_commit, w.lower_commit]) if (c) s.add(checkoutKey(w.namespace, w.repo, c))
    }
    return s
  }

  /** Distinct (ns, repo, branch) targets for the prewarm poller. */
  prewarmTargets(): Array<{ namespace: string; repo: string; branch: string }> {
    const m = new Map<string, { namespace: string; repo: string; branch: string }>()
    for (const w of this.states.values()) {
      if (w.branch) m.set(`${w.namespace}/${w.repo}@${w.branch}`, { namespace: w.namespace, repo: w.repo, branch: w.branch })
    }
    return [...m.values()]
  }

  private save(st: WorkspaceState): void {
    st.updated_at = new Date(this.now()).toISOString()
    this.stateDoc(st.id).write(st)
  }

  // ── create / retry / delete ────────────────────────────────────────
  async create(input: CreateInput): Promise<WorkspacePublic> {
    const { namespace, repo } = input
    if (!validNs(namespace) || !validNs(repo)) throw new WorkspaceError('invalid namespace or repo', 400)
    const ref = 'branch' in input.source ? input.source.branch : input.source.commit
    if (typeof ref !== 'string' || !ref || /[\0\\]/.test(ref) || ref.split('/').includes('..')) {
      throw new WorkspaceError('source.branch or source.commit is required', 400)
    }
    const cleanSource: { branch: string } | { commit: string } = 'branch' in input.source ? { branch: ref } : { commit: ref }
    const branchName = 'branch' in cleanSource ? cleanSource.branch : null
    const id = newWorkspaceId()
    const explicitName = (input.name ?? '').trim()
    const name = explicitName || generatedName(id, branchName, branchName ? undefined : ref)
    if (!NAME_RE.test(name)) throw new WorkspaceError('invalid workspace name (1-64 chars: letters, digits, space, . _ - @ +)', 400)
    const dup = [...this.states.values()].some(
      (w) => w.namespace === namespace && w.repo === repo && w.name.toLowerCase() === name.toLowerCase(),
    )
    if (dup) throw new WorkspaceError(`a workspace named "${name}" already exists in ${namespace}/${repo}`, 409)
    if (this.cfg.wsMaxTotalBytes) {
      const total = [...this.states.values()].reduce((a, w) => a + (w.last_scan?.upper_bytes ?? 0), 0)
      if (total >= this.cfg.wsMaxTotalBytes) throw new WorkspaceError('workspace storage quota exhausted (WORKSPACES_MAX_TOTAL_BYTES)', 507)
    }
    const driver = await this.pickDriver()
    const nowIso = new Date(this.now()).toISOString()
    const st: WorkspaceState = {
      id,
      kind: input.kind ?? 'user',
      name,
      generated_name: !explicitName,
      namespace,
      repo,
      branch: branchName,
      source: cleanSource,
      base_commit: null,
      lower_commit: null,
      gen: 0,
      status: 'preparing',
      op: 'idle',
      op_id: null,
      quota_bytes: this.cfg.wsMaxBytes,
      driver,
      last_error: null,
      retry_count: 0,
      next_retry_at: null,
      last_scan: null,
      created_by: input.createdBy.email,
      created_by_sub: input.createdBy.sub,
      created_at: nowIso,
      updated_at: nowIso,
    }
    await mkdir(this.dir(id), { recursive: true })
    if ([...this.states.values()].some(
      (w) => w.namespace === namespace && w.repo === repo && w.name.toLowerCase() === name.toLowerCase(),
    )) {
      await rm(this.dir(id), { recursive: true, force: true })
      throw new WorkspaceError(`a workspace named "${name}" already exists in ${namespace}/${repo}`, 409)
    }
    this.states.set(id, st)
    this.save(st)
    this.kick(id, 0)
    return this.toPublic(st)
  }

  async retry(id: string): Promise<WorkspacePublic> {
    const st = this.mustGet(id)
    if (st.status === 'ready') throw new WorkspaceError('workspace is already ready', 409)
    if (this.running.has(id)) throw new WorkspaceError('preparation is already running', 409)
    st.status = 'preparing'
    st.retry_count = 0
    st.next_retry_at = null
    this.save(st)
    this.kick(id, 0)
    return this.toPublic(st)
  }

  /** No leases exist yet (W3): delete is unconditional. */
  async delete(id: string): Promise<WorkspaceState> {
    const st = this.mustGet(id)
    if (this.leases.hasAny(id)) {
      const held = this.leases.list(id)
      const who = held.map((l) => `${l.holder.kind} ${l.holder.label ?? l.holder.id} (${l.mode})`)
      const shown = who.slice(0, 5).join(', ') + (who.length > 5 ? `, +${who.length - 5} more` : '')
      throw new LeaseError(`workspace is in use: ${shown}`, 423, this.leases.writer(id)?.holder ?? held[0]?.holder)
    }
    // Belt and braces: a live session mounting this workspace blocks delete even if its lease is gone.
    const sess = ((await listSessions()).filter(
      (x) => !['stopped', 'failed', 'destroyed'].includes(x.status) && (x.mounts ?? []).some((m) => m.workspace_id === id),
    ))
    if (sess.length) {
      const who = sess.slice(0, 5).map((x) => `session ${x.id.slice(0, 8)}`)
      const first = sess[0]!
      throw new LeaseError(
        `workspace is in use: ${who.join(', ')}${sess.length > 5 ? `, +${sess.length - 5} more` : ''}`,
        423,
        { kind: 'session', id: first.id, label: first.id.slice(0, 8), user: first.owner.email },
      )
    }
    // Volumes first: refuses while a container still has the generation volume mounted.
    try {
      for (const v of await this.docker.volumeList(`mice-ws-${id}-g`)) await this.docker.volumeRm(v)
    } catch (err) {
      if (err instanceof DockerInUseError) throw new WorkspaceError(`workspace is in use by a container (${err.message})`, 409)
      if (!(err instanceof Error) || !/docker|ENOENT/i.test(err.message)) throw err
    }
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.delete(id)
    this.states.delete(id)
    this.scans.delete(id)
    this.bases.delete(id)
    this.leases.dropWorkspace(id)
    await rm(this.dir(id), { recursive: true, force: true })
    return st
  }

  // ── preparation (async, retried) ───────────────────────────────────
  private kick(id: string, delayMs: number): void {
    const old = this.timers.get(id)
    if (old) clearTimeout(old)
    const t = setTimeout(() => {
      this.timers.delete(id)
      void this.prepare(id)
    }, delayMs)
    t.unref()
    this.timers.set(id, t)
  }

  /** Awaitable for tests: resolves when the in-flight preparation (if any) finishes. */
  async whenSettled(id: string, timeoutMs = 20_000): Promise<WorkspaceState> {
    const t0 = Date.now()
    for (;;) {
      const st = this.mustGet(id)
      if (st.status !== 'preparing' || (st.next_retry_at && !this.running.has(id))) return st
      if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for workspace')
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  private async prepare(id: string): Promise<void> {
    const st = this.states.get(id)
    if (!st || this.running.has(id) || st.status === 'ready') return
    this.running.add(id)
    try {
      const age = (this.now() - Date.parse(st.created_at)) / 1000
      if (age > this.cfg.prepareTimeoutSec) throw new WorkspaceError('workspace preparation timed out', 504)
      const ref = 'branch' in st.source ? st.source.branch : st.source.commit
      const { commit, done } = await this.store.startCheckout(st.namespace, st.repo, ref)
      // Pin early so GC cannot evict the checkout we are about to use.
      st.base_commit = commit
      st.lower_commit = commit
      if (st.generated_name) st.name = generatedName(st.id, st.branch, commit)
      st.next_retry_at = null
      this.save(st)
      await done
      if (!this.states.has(id)) return
      const manifest = await this.store.loadManifest(st.namespace, st.repo, commit)
      this.baseDoc(id).write(baseToJson(manifest) as { files: Record<string, BaseFile> })
      this.bases.delete(id)
      await this.prepareDriver(st, manifest)
      if (!this.states.has(id)) {
        await rm(this.dir(id), { recursive: true, force: true })
        return
      }
      st.status = 'ready'
      st.last_error = null
      st.retry_count = 0
      this.save(st)
    } catch (err) {
      if (!this.states.has(id)) return
      this.failPrepare(st, err)
    } finally {
      this.running.delete(id)
    }
  }

  private failPrepare(st: WorkspaceState, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    const retryable =
      (err instanceof OxenError && err.retryable) ||
      (err instanceof StoreError && (err.retryable || err.status === 502)) ||
      (err as NodeJS.ErrnoException | undefined)?.code === 'ECONNRESET'
    st.last_error = message
    if (retryable) {
      const backoff = this.cfg.retryBackoffMs
      const delay = backoff[Math.min(st.retry_count, backoff.length - 1)] ?? 60_000
      st.retry_count += 1
      st.status = 'preparing'
      st.next_retry_at = new Date(this.now() + delay).toISOString()
      this.save(st)
      this.kick(st.id, delay)
    } else {
      st.status = 'error'
      st.next_retry_at = null
      this.save(st)
    }
  }

  private async prepareDriver(st: WorkspaceState, manifest: Manifest): Promise<void> {
    const d = this.dir(st.id)
    if (st.driver === 'overlay') {
      await mkdir(join(d, 'upper'), { recursive: true })
      await mkdir(join(d, 'work'), { recursive: true })
      return
    }
    if (manifest.files.size > this.cfg.copyMaxFiles && st.driver === 'copy') {
      throw new WorkspaceError(
        `copy driver refuses ${manifest.files.size} files (> WORKSPACES_COPY_MAX_FILES=${this.cfg.copyMaxFiles})`,
        413,
      )
    }
    await rm(join(d, 'tree'), { recursive: true, force: true })
    await cp(this.store.treeDir(st.namespace, st.repo, st.lower_commit!), join(d, 'tree'), {
      recursive: true,
      mode: st.driver === 'reflink' ? constants.COPYFILE_FICLONE_FORCE : 0,
    })
  }

  /** Repair legacy ownership too, before handing a writable tree to a guest. */
  async prepareWritePermissions(st: WorkspaceState): Promise<void> {
    const { uid, gid } = this.cfg
    if (uid === null || gid === null) return
    const own = async (path: string): Promise<void> => {
      const stat = await lstat(path)
      if (!stat.isDirectory() && !stat.isFile()) return
      if (stat.uid !== uid || stat.gid !== gid) await chown(path, uid, gid)
      const mode = stat.mode & 0o777
      const writable = mode | (stat.isDirectory() ? 0o700 : 0o600)
      if (mode !== writable) await chmod(path, writable)
      if (stat.isDirectory()) {
        for (const entry of await readdir(path)) await own(join(path, entry))
      }
    }
    if (st.driver === 'overlay') {
      // Copy-up preserves lower inode permissions. Changing metadata here keeps
      // checkout/blob hardlinks shared rather than copying every file into upper.
      await own(this.store.treeDir(st.namespace, st.repo, st.lower_commit!))
      await own(join(this.dir(st.id), 'upper'))
      await own(join(this.dir(st.id), 'work'))
    } else {
      await own(join(this.dir(st.id), 'tree'))
    }
  }

  // ── reads ──────────────────────────────────────────────────────────
  private mustGet(id: string): WorkspaceState {
    const st = this.states.get(id)
    if (!st) throw new WorkspaceError('Workspace not found', 404)
    return st
  }

  getState(id: string): WorkspaceState | undefined {
    return this.states.get(id)
  }

  list(filter: { namespace?: string; repo?: string } = {}): WorkspacePublic[] {
    return [...this.states.values()]
      .filter((w) => (!filter.namespace || w.namespace === filter.namespace) && (!filter.repo || w.repo === filter.repo))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((w) => this.toPublic(w))
  }

  /** Detail: refreshes the live scan and the branch head (best effort). */
  async get(id: string): Promise<WorkspacePublic> {
    const st = this.mustGet(id)
    if (st.status === 'ready') await this.scan(id).catch(() => undefined)
    await this.refreshHead(st)
    return this.toPublic(st)
  }

  private async refreshHead(st: WorkspaceState): Promise<void> {
    if (!st.branch) return
    const key = `${st.namespace}/${st.repo}@${st.branch}`
    const cur = this.heads.get(key)
    if (cur && this.now() - cur.at < 30_000) return
    try {
      const commit = await Promise.race([
        this.store.oxen.resolveCommit(st.namespace, st.repo, st.branch),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000).unref()),
      ])
      this.heads.set(key, { commit, at: this.now() })
    } catch {
      /* behind stays at its last known value */
    }
  }

  /** Called by the prewarm poller so list views can show `behind` without Oxen calls. */
  noteBranchHead(ns: string, repo: string, branch: string, commit: string): void {
    this.heads.set(`${ns}/${repo}@${branch}`, { commit, at: this.now() })
  }

  toPublic(st: WorkspaceState): WorkspacePublic {
    const scan = st.last_scan
    const head = st.branch ? this.heads.get(`${st.namespace}/${st.repo}@${st.branch}`)?.commit : undefined
    let progress: Progress | null = null
    if (st.status === 'preparing' && st.base_commit) {
      progress = this.store.progressFor(st.namespace, st.repo, st.base_commit)
    }
    if (st.status === 'preparing' && !progress) {
      progress = { phase: 'resolving', files_done: 0, files_total: 0, bytes_done: 0, bytes_total: 0 }
    }
    const over_quota = (scan?.upper_bytes ?? 0) > st.quota_bytes || (scan?.files ?? 0) > this.cfg.wsMaxFiles
    return {
      id: st.id,
      kind: st.kind,
      name: st.name,
      namespace: st.namespace,
      repo: st.repo,
      branch: st.branch,
      base_commit: st.base_commit,
      lower_commit: st.lower_commit,
      status: st.status,
      op: st.op,
      last_error: st.last_error,
      progress,
      upper_bytes: scan?.upper_bytes ?? 0,
      change_counts: { added: scan?.added ?? 0, modified: scan?.modified ?? 0, removed: scan?.removed ?? 0 },
      quota_bytes: st.quota_bytes,
      driver: st.driver,
      behind: !!head && !!st.base_commit && head !== st.base_commit,
      leases: this.leases.list(st.id).map(toPublicLease),
      writer: this.leases.writer(st.id)?.holder ?? null,
      session_count: new Set(this.leases.list(st.id).filter((l) => l.holder.kind === 'session').map((l) => l.holder.id)).size,
      over_quota,
      mountable_modes:
        st.status !== 'ready' ? [] : this.leases.writer(st.id) || over_quota || st.op !== 'idle' ? ['ro'] : ['ro', 'rw'],
      next_retry_at: st.next_retry_at,
      created_by: st.created_by,
      created_at: st.created_at,
      updated_at: st.updated_at,
    }
  }

  // ── scan / changes / files ─────────────────────────────────────────
  private async baseIndex(st: WorkspaceState): Promise<BaseIndex> {
    let b = this.bases.get(st.id)
    if (!b) {
      const raw = this.baseDoc(st.id).read()
      if (!raw) throw new Error(`workspace ${st.id} has no readable base index`)
      b = new BaseIndex(new Map(Object.entries(raw.files)))
      this.bases.set(st.id, b)
    }
    return b
  }

  private requireReady(id: string): WorkspaceState {
    const st = this.mustGet(id)
    if (st.status !== 'ready') throw new WorkspaceError(`workspace is ${st.status}`, 409)
    return st
  }

  async scan(id: string, opts: { force?: boolean } = {}): Promise<ScanResult> {
    const st = this.requireReady(id)
    const cached = this.scans.get(id)
    if (!opts.force && cached && this.now() - cached.at < this.cfg.scanTtlMs) return cached.result
    const base = await this.baseIndex(st)
    const cachePath = join(this.dir(id), 'changes-cache.json')
    const result =
      st.driver === 'overlay'
        ? await scanUpper({ upper: join(this.dir(id), 'upper'), base, cachePath, readMarkers: this.readMarkers, now: this.now() })
        : await scanTree({ tree: join(this.dir(id), 'tree'), base, cachePath, now: this.now() })
    this.scans.set(id, { at: this.now(), result })
    const summary = {
      upper_bytes: result.upper_bytes,
      added: result.added.length,
      modified: result.modified.length,
      removed: result.removed.length,
      files: result.files,
      at: result.scanned_at,
    }
    if (JSON.stringify({ ...st.last_scan, at: 0 }) !== JSON.stringify({ ...summary, at: 0 })) {
      st.last_scan = summary
      this.save(st)
    } else if (st.last_scan) st.last_scan.at = summary.at
    return result
  }

  async changes(id: string): Promise<Changes> {
    const r = await this.scan(id, { force: true })
    const { entries: _e, removedSet: _r, whiteouts: _w, opaque: _o, upperDirs: _d, ...changes } = r
    void [_e, _r, _w, _o, _d]
    return changes
  }

  /** Directory listing or file handle from the effective tree (§5.2/§5.3). */
  async readPath(
    id: string,
    rawPath: string,
  ): Promise<{ kind: 'dir'; path: string; entries: DirEntryOut[] } | { kind: 'file'; path: string; file: OpenedFile; sha256: string | null }> {
    const st = this.requireReady(id)
    const path = cleanRelPath(rawPath)
    const scan = await this.scan(id)
    const base = await this.baseIndex(st)
    const hit = await this.resolveFile(st, scan, base, path)
    if (hit) return { kind: 'file', path, file: await openInside(hit.root, path), sha256: hit.sha256 }
    const entries = effectiveListDir(base, scan, path)
    if (!entries) throw new PathError('not found', 404)
    return { kind: 'dir', path, entries }
  }

  private async resolveFile(
    st: WorkspaceState,
    scan: ScanResult,
    base: BaseIndex,
    path: string,
  ): Promise<{ root: string; sha256: string | null } | null> {
    if (!path) return null
    const up = scan.entries.get(path)
    if (up) {
      return { root: st.driver === 'overlay' ? join(this.dir(st.id), 'upper') : join(this.dir(st.id), 'tree'), sha256: up.sha256 }
    }
    const b = base.files.get(path)
    if (b && !scan.removedSet.has(path) && st.driver === 'overlay') {
      return { root: this.store.treeDir(st.namespace, st.repo, st.lower_commit!), sha256: b.sha256 }
    }
    return null
  }

  /** tar of the effective tree, computed by the BFF from upper + checkout (no mount needed). */
  async archive(id: string): Promise<AsyncGenerator<Buffer>> {
    const st = this.requireReady(id)
    const scan = await this.scan(id)
    const base = await this.baseIndex(st)
    const items = [...effectivePaths(base, scan)]
    return tarStream(items, async (p) => {
      const hit = await this.resolveFile(st, scan, base, p)
      if (!hit) throw new PathError('file vanished', 404)
      return openInside(hit.root, p)
    })
  }

  // ── leases (§6.1) ──────────────────────────────────────────────────
  leaseView(id: string): LeaseWorkspaceView {
    const st = this.mustGet(id)
    return {
      status: st.status,
      op: st.op,
      over_quota: this.toPublic(st).over_quota,
      upperHash: async () => upperHashOf(await this.scan(id, { force: true })),
    }
  }

  /** Fresh scan so the quota check sees the current upper (best effort). */
  private async refreshForWrite(inputs: AcquireInput[]): Promise<void> {
    for (const i of inputs) {
      if (i.mode === 'write' && this.states.get(i.workspaceId)?.status === 'ready') {
        await this.scan(i.workspaceId, { force: true }).catch(() => undefined)
      }
    }
  }

  async acquireLease(input: AcquireInput): Promise<Lease> {
    this.mustGet(input.workspaceId)
    await this.refreshForWrite([input])
    return this.leases.acquire(input, this.leaseView(input.workspaceId))
  }

  /** Multi-workspace acquire: all-or-nothing, sorted by workspace id. */
  async acquireLeases(inputs: AcquireInput[]): Promise<Lease[]> {
    for (const i of inputs) this.mustGet(i.workspaceId)
    await this.refreshForWrite(inputs)
    return this.leases.acquireMany(inputs, (id) => this.leaseView(id))
  }

  async usage(): Promise<{ workspaces: number; upper_bytes: number }> {
    let bytes = 0
    for (const w of this.states.values()) bytes += w.last_scan?.upper_bytes ?? 0
    return { workspaces: this.states.size, upper_bytes: bytes }
  }
}

async function defaultHolderState(h: LeaseHolder): Promise<'alive' | 'gone' | 'unknown'> {
  try {
    if (h.kind === 'job') {
      const j = await getJob(h.id)
      if (!j) return 'gone'
      return ['succeeded', 'failed', 'cancelled'].includes(j.status) ? 'gone' : 'alive'
    }
    if (h.kind === 'session') {
      const sess = await getSessionRecord(h.id)
      if (!sess) return 'gone'
      return ['stopped', 'failed', 'destroyed'].includes(sess.status) ? 'gone' : 'alive'
    }
  } catch {
    /* stores unavailable: never release on a guess */
  }
  return 'unknown'
}

function baseToJson(m: Manifest): unknown {
  return {
    version: 1,
    commit: m.commit,
    files: Object.fromEntries(m.files),
  }
}

let svc: WorkspaceService | null = null
export function getWorkspaceService(): WorkspaceService | null {
  return svc
}
export function setWorkspaceService(s: WorkspaceService | null): void {
  svc = s
}
