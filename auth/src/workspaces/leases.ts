import { createHash, randomBytes } from 'node:crypto'
import { createDiskDocument, type DiskDocument } from '../diskStore.js'
import type { WorkspacesConfig } from './config.js'
import type { ScanResult } from './scan.js'

export type LeaseMode = 'read' | 'write'
export type HolderKind = 'job' | 'session' | 'user' | 'api'

export type LeaseHolder = {
  kind: HolderKind
  id: string
  label?: string
  /** Email of the principal the lease was taken for. */
  user: string
}

export type Lease = {
  id: string
  workspace_id: string
  mode: LeaseMode
  holder: LeaseHolder
  created_at: string
  expires_at: string
  renewed_at: string
  /** Write leases only: hash of the upper dir at grant (§6.1 tamper check). */
  upper_hash: string | null
  /** Subject of the owner; not exposed through the API. */
  owner_sub: string
}

export type LeasePublic = Omit<Lease, 'owner_sub'>

export class LeaseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly holder?: LeaseHolder,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'LeaseError'
  }
}

/** Upper changed between lease grant and use. */
export class TamperError extends LeaseError {
  constructor(message = 'workspace changed before start') {
    super(message, 409, undefined, 'workspace_changed')
    this.name = 'TamperError'
  }
}

export const toPublicLease = ({ owner_sub: _o, ...rest }: Lease): LeasePublic => {
  void _o
  return rest
}

export function newLeaseId(): string {
  return `l_${Array.from(randomBytes(12), (b) => (b % 36).toString(36)).join('')}`
}

/** Hash of the scan result: file contents, whiteouts, opaque dirs and upper dirs. */
export function upperHashOf(scan: Pick<ScanResult, 'entries' | 'whiteouts' | 'opaque' | 'upperDirs' | 'special'>): string {
  const h = createHash('sha256')
  const part = (tag: string, items: string[]) => {
    h.update(`${tag}\0${items.length}\0`)
    for (const i of items) h.update(`${i}\0`)
  }
  part('f', [...scan.entries].map(([p, e]) => `${p}\t${e.size}\t${e.sha256}`).sort())
  part('w', [...scan.whiteouts].sort())
  part('o', [...scan.opaque].sort())
  part('d', [...scan.upperDirs].sort())
  part('s', scan.special.map((s) => `${s.path}\t${s.kind}`).sort())
  return h.digest('hex')
}

type Mutex = Promise<void>

/** What the lease store needs to know about a workspace (service-provided). */
export type LeaseWorkspaceView = {
  status: string
  op: string
  over_quota: boolean
  /** Fresh scan hash for write grants. */
  upperHash: () => Promise<string>
}

export type AcquireInput = {
  workspaceId: string
  mode: LeaseMode
  holder: Omit<LeaseHolder, 'user'> & { user?: string }
  ttlSec?: number
  ownerSub: string
  ownerEmail: string
}

export type HolderState = 'alive' | 'gone'

/**
 * Persisted lease table. All mutations of one workspace are serialized by a mutex so
 * "at most one write lease" is atomic; multi-workspace acquires take the mutexes in
 * sorted workspace_id order and roll back on any failure.
 */
export class LeaseStore {
  private leases = new Map<string, Lease>()
  private readonly locks = new Map<string, Mutex>()
  private readonly waiting = new Set<string>()

  private readonly doc: DiskDocument<{ version: 1; leases: Lease[] }>

  constructor(
    path: string,
    private readonly cfg: Pick<WorkspacesConfig, 'leaseTtlSec' | 'leaseMaxTtlSec' | 'leaseOrphanGraceMs'>,
    private readonly now: () => number = Date.now,
  ) {
    this.doc = createDiskDocument(path)
    for (const l of this.doc.read()?.leases ?? []) this.leases.set(l.id, l)
  }

  private persist(): void {
    this.doc.write({ version: 1, leases: [...this.leases.values()] })
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    const chain = prev.then(() => mine)
    this.locks.set(id, chain)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(id) === chain) this.locks.delete(id)
    }
  }

  private async withLocks<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
    const [first, ...rest] = ids
    if (first === undefined) return fn()
    return this.withLock(first, () => this.withLocks(rest, fn))
  }

  private isExpired(l: Lease): boolean {
    return Date.parse(l.expires_at) <= this.now()
  }

  /** Active (non-expired) leases of a workspace. */
  list(workspaceId: string): Lease[] {
    return [...this.leases.values()]
      .filter((l) => l.workspace_id === workspaceId && !this.isExpired(l))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  all(): Lease[] {
    return [...this.leases.values()]
  }

  get(leaseId: string): Lease | undefined {
    const l = this.leases.get(leaseId)
    return l && !this.isExpired(l) ? l : undefined
  }

  writer(workspaceId: string): Lease | undefined {
    return this.list(workspaceId).find((l) => l.mode === 'write')
  }

  hasAny(workspaceId: string): boolean {
    return this.list(workspaceId).length > 0
  }

  /** Hook for the jobs queue (W5): while set, new `session` writers are refused. */
  setWriterWaiting(workspaceId: string, waiting: boolean): void {
    if (waiting) this.waiting.add(workspaceId)
    else this.waiting.delete(workspaceId)
  }
  isWriterWaiting(workspaceId: string): boolean {
    return this.waiting.has(workspaceId)
  }

  private ttl(ttlSec?: number): number {
    const t = ttlSec === undefined || !Number.isFinite(ttlSec) || ttlSec <= 0 ? this.cfg.leaseTtlSec : ttlSec
    return Math.min(Math.floor(t), this.cfg.leaseMaxTtlSec)
  }

  private dropExpired(workspaceId?: string): Lease[] {
    const out: Lease[] = []
    for (const l of this.leases.values()) {
      if ((workspaceId === undefined || l.workspace_id === workspaceId) && this.isExpired(l)) {
        this.leases.delete(l.id)
        out.push(l)
      }
    }
    if (out.length) this.persist()
    return out
  }

  /** Must run under the workspace lock. Returns the new lease (already stored, not yet persisted). */
  private async acquireLocked(input: AcquireInput, view: LeaseWorkspaceView): Promise<Lease> {
    this.dropExpired(input.workspaceId)
    if (view.status !== 'ready') throw new LeaseError(`workspace is ${view.status}`, 409)
    if (view.op !== 'idle') throw new LeaseError(`workspace is busy (${view.op})`, 409)
    let upperHash: string | null = null
    if (input.mode === 'write') {
      const held = this.writer(input.workspaceId)
      if (held) throw new LeaseError('workspace is write-locked', 423, held.holder)
      if (view.over_quota) throw new LeaseError('workspace is over quota; no new writer leases', 507)
      if (input.holder.kind === 'session' && this.waiting.has(input.workspaceId)) {
        throw new LeaseError('a writer is waiting for this workspace', 423)
      }
      upperHash = await view.upperHash()
    }
    const nowIso = new Date(this.now()).toISOString()
    const lease: Lease = {
      id: newLeaseId(),
      workspace_id: input.workspaceId,
      mode: input.mode,
      holder: {
        kind: input.holder.kind,
        id: input.holder.id,
        ...(input.holder.label ? { label: input.holder.label } : {}),
        user: input.holder.user ?? input.ownerEmail,
      },
      created_at: nowIso,
      renewed_at: nowIso,
      expires_at: new Date(this.now() + this.ttl(input.ttlSec) * 1000).toISOString(),
      upper_hash: upperHash,
      owner_sub: input.ownerSub,
    }
    this.leases.set(lease.id, lease)
    return lease
  }

  async acquire(input: AcquireInput, view: LeaseWorkspaceView): Promise<Lease> {
    return this.withLock(input.workspaceId, async () => {
      const lease = await this.acquireLocked(input, view)
      this.persist()
      return lease
    })
  }

  /**
   * All-or-nothing across workspaces, in sorted workspace_id order. On any refusal nothing
   * is granted and the error names the workspace. Returns leases in request order.
   */
  async acquireMany(
    inputs: AcquireInput[],
    viewOf: (workspaceId: string) => LeaseWorkspaceView,
  ): Promise<Lease[]> {
    const sorted = [...inputs].sort((a, b) => (a.workspaceId < b.workspaceId ? -1 : a.workspaceId > b.workspaceId ? 1 : 0))
    const ids = [...new Set(sorted.map((i) => i.workspaceId))]
    return this.withLocks(ids, async () => {
      const granted: Lease[] = []
      try {
        for (const input of sorted) granted.push(await this.acquireLocked(input, viewOf(input.workspaceId)))
      } catch (err) {
        const failedId = sorted[granted.length]?.workspaceId ?? '?'
        for (const l of granted) this.leases.delete(l.id)
        if (err instanceof LeaseError) {
          throw new LeaseError(`${failedId}: ${err.message}`, err.status, err.holder, err.code)
        }
        throw err
      }
      this.persist()
      return inputs.map((i) => granted[sorted.indexOf(i)]!)
    })
  }

  async renew(leaseId: string, ttlSec?: number): Promise<Lease> {
    const l = this.get(leaseId)
    if (!l) throw new LeaseError('Lease not found or expired', 404)
    return this.withLock(l.workspace_id, async () => {
      const cur = this.get(leaseId)
      if (!cur) throw new LeaseError('Lease not found or expired', 404)
      cur.renewed_at = new Date(this.now()).toISOString()
      cur.expires_at = new Date(this.now() + this.ttl(ttlSec) * 1000).toISOString()
      this.persist()
      return cur
    })
  }

  async release(leaseId: string): Promise<Lease | undefined> {
    const l = this.leases.get(leaseId)
    if (!l) return undefined
    return this.withLock(l.workspace_id, async () => {
      const cur = this.leases.get(leaseId)
      if (!cur) return undefined
      this.leases.delete(leaseId)
      this.persist()
      return cur
    })
  }

  /** Drop every lease of a workspace (after the workspace is gone). */
  dropWorkspace(workspaceId: string): void {
    let changed = false
    for (const l of [...this.leases.values()]) {
      if (l.workspace_id === workspaceId) {
        this.leases.delete(l.id)
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /**
   * §6.1 reconciliation: expired leases, leases of vanished workspaces and leases whose
   * holder reports `gone`. Returns what was released and why.
   */
  async reconcile(opts: {
    workspaceExists: (id: string) => boolean
    holderState?: (h: LeaseHolder) => HolderState | 'unknown' | Promise<HolderState | 'unknown'>
  }): Promise<Array<{ lease: Lease; reason: 'expired' | 'workspace_gone' | 'holder_gone' }>> {
    const out: Array<{ lease: Lease; reason: 'expired' | 'workspace_gone' | 'holder_gone' }> = []
    for (const l of [...this.leases.values()]) {
      let reason: 'expired' | 'workspace_gone' | 'holder_gone' | null = null
      if (this.isExpired(l)) reason = 'expired'
      else if (!opts.workspaceExists(l.workspace_id)) reason = 'workspace_gone'
      else if (opts.holderState && this.now() - Date.parse(l.created_at) >= this.cfg.leaseOrphanGraceMs) {
        if ((await opts.holderState(l.holder)) === 'gone') reason = 'holder_gone'
      }
      if (!reason) continue
      const released = await this.release(l.id)
      if (released) out.push({ lease: released, reason })
    }
    return out
  }
}
