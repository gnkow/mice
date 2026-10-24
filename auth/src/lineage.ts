import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { env } from './env.js'
import { createJsonlLog } from './stores.js'
import type { AuditActor, AuditVia } from './audit.js'

export type LineageKind =
  | 'upload'
  | 'create'
  | 'edit'
  | 'move'
  | 'rename'
  | 'copy'
  | 'delete'
  | 'restore'
  /** Container job run: inputs = observed reads @ pin; outputs = written @ result (either may be empty). */
  | 'job'

/** Same parent dir + different basename → rename; otherwise move. */
export function isRenamePathChange(fromPath: string, toPath: string): boolean {
  const norm = (p: string) => p.replace(/^\/+|\/+$/g, '')
  const from = norm(fromPath)
  const to = norm(toPath)
  if (!from || !to || from === to) return false
  const fromParts = from.split('/').filter(Boolean)
  const toParts = to.split('/').filter(Boolean)
  const fromBase = fromParts[fromParts.length - 1] ?? ''
  const toBase = toParts[toParts.length - 1] ?? ''
  const fromParent = fromParts.slice(0, -1).join('/')
  const toParent = toParts.slice(0, -1).join('/')
  return fromParent === toParent && fromBase !== toBase
}

export function pathChangeKind(
  fromPath: string,
  toPath: string,
): 'rename' | 'move' {
  return isRenamePathChange(fromPath, toPath) ? 'rename' : 'move'
}

function normPath(p: string): string {
  return p.replace(/^\/+|\/+$/g, '')
}

function pathBaseName(p: string): string {
  const parts = normPath(p).split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

export type CommitDiffPath = {
  path: string
  contentHash: string
}

/**
 * Same-commit copy candidates: path added with hash H, and a base-tree path
 * that still holds H was not removed in that commit. Source and destination
 * MUST share the same basename; if several same-basename sources remain,
 * pick the first (stable). Different-basename hash reuse is not a copy.
 *
 * Distinct from move/rename: those pair removed+added with the same hash.
 */
export function inferCopyPairs(opts: {
  added: CommitDiffPath[]
  removedPaths: Iterable<string>
  /** Paths that held each content hash in the pre-commit (base) tree. */
  basePathsByHash: Map<string, string[]>
}): Array<{ sourcePath: string; newPath: string; contentHash: string }> {
  const removed = new Set(
    [...opts.removedPaths].map(normPath).filter(Boolean),
  )
  const pairs: Array<{
    sourcePath: string
    newPath: string
    contentHash: string
  }> = []

  for (const a of opts.added) {
    const newPath = normPath(a.path)
    const hash = a.contentHash?.trim()
    if (!newPath || !hash) continue

    const base = pathBaseName(newPath)
    const sources = (opts.basePathsByHash.get(hash) ?? [])
      .map(normPath)
      .filter(
        (p) =>
          p &&
          p !== newPath &&
          !removed.has(p) &&
          pathBaseName(p) === base,
      )

    const sourcePath = sources[0]
    if (!sourcePath) continue

    pairs.push({ sourcePath, newPath, contentHash: hash })
  }

  return pairs
}

export type LineageSource = 'explicit' | 'derived'
export type LineageConfidence = 'high' | 'low'

export type FileVersion = {
  namespace: string
  repo: string
  path: string
  contentHash?: string
  commitId?: string
}

export type LineageOp = {
  id: string
  ts: string
  kind: LineageKind
  namespace: string
  repo: string
  branch?: string
  inputs: FileVersion[]
  outputs: FileVersion[]
  actor?: AuditActor
  via?: AuditVia
  commitId?: string
  auditEventId?: string
  source: LineageSource
  confidence: LineageConfidence
  detail?: Record<string, unknown>
}

export type LineageQuery = {
  namespace: string
  repo: string
  path?: string
  contentHash?: string
  direction?: 'ancestors' | 'descendants' | 'both'
  depth?: number
  since?: string
  until?: string
  limit?: number
  cursor?: string
  kind?: LineageKind
  /** Filter job ops by JobRun id (detail.job_id). */
  jobId?: string
  /** Filter ops that reference this commit (pin or result). */
  commit?: string
}

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50
const DEFAULT_DEPTH = 8
const MAX_DEPTH = 32

function storePath(): string {
  return join(env.dataDir, 'lineage.jsonl')
}

const log = createJsonlLog<LineageOp>(storePath)

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** File mutate classification for lineage (finer than audit `file.write`). */
export function classifyFileLineageOp(
  method: string,
  pathname: string,
  opts?: {
    newPath?: string
    priorExists?: boolean
    copyFrom?: string
    /** Commit id (or revision) of the version being restored. */
    restoreFrom?: string
  },
): {
  kind: LineageKind | null
  namespace?: string
  repo?: string
  branch?: string
  path?: string
  newPath?: string
} {
  const path = pathname.replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'repos' || parts.length < 5) {
    return { kind: null }
  }
  const namespace = safeDecode(parts[2])
  const repo = safeDecode(parts[3])
  const rest = parts.slice(4)
  if (rest[0] !== 'file') return { kind: null }

  const branch = rest[1] ? safeDecode(rest[1]) : undefined
  const filePath = rest.slice(2).map(safeDecode).join('/')
  const m = method.toUpperCase()

  if (m === 'PATCH' && opts?.newPath) {
    return {
      kind: pathChangeKind(filePath, opts.newPath),
      namespace,
      repo,
      branch,
      path: filePath,
      newPath: opts.newPath,
    }
  }
  if (m === 'DELETE') {
    return { kind: 'delete', namespace, repo, branch, path: filePath }
  }
  if (m === 'PUT' || m === 'POST') {
    const copyFrom = opts?.copyFrom?.trim().replace(/^\/+|\/+$/g, '')
    if (
      copyFrom &&
      copyFrom !== filePath &&
      pathBaseName(copyFrom) === pathBaseName(filePath)
    ) {
      return {
        kind: 'copy',
        namespace,
        repo,
        branch,
        path: copyFrom,
        newPath: filePath,
      }
    }
    const restoreFrom = opts?.restoreFrom?.trim()
    if (restoreFrom) {
      // Bring a deleted (or historical) version back to the same path.
      return { kind: 'restore', namespace, repo, branch, path: filePath }
    }
    // Prior version at path → edit; otherwise first write → upload.
    const kind: LineageKind = opts?.priorExists ? 'edit' : 'upload'
    return { kind, namespace, repo, branch, path: filePath }
  }
  return { kind: null, namespace, repo, branch, path: filePath }
}

export type FileEntrySnapshot = {
  contentHash?: string
  commitId?: string
}

/** Parse oxen `/meta/…` JSON for content hash + latest commit id. */
export function parseFileEntrySnapshot(body: unknown): FileEntrySnapshot | null {
  if (!body || typeof body !== 'object') return null
  const entry = (body as { entry?: Record<string, unknown> }).entry
  const src = entry && typeof entry === 'object' ? entry : (body as Record<string, unknown>)
  const hash =
    typeof src.hash === 'string' && src.hash.trim() ? src.hash.trim() : undefined
  const latest = src.latest_commit
  let commitId: string | undefined
  if (latest && typeof latest === 'object') {
    const id = (latest as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) commitId = id.trim()
  }
  if (!hash && !commitId) return null
  return {
    ...(hash ? { contentHash: hash } : {}),
    ...(commitId ? { commitId } : {}),
  }
}

/**
 * Best-effort lookup of the current file entry on a branch (or revision).
 * Used to distinguish upload vs edit and to populate prior version refs.
 */
export async function fetchFileEntrySnapshot(
  namespace: string,
  repo: string,
  revision: string,
  filePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FileEntrySnapshot | null> {
  const resource = [revision, ...filePath.split('/').filter(Boolean)]
    .map((p) => encodeURIComponent(p))
    .join('/')
  const url = `${env.oxenUpstream}/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/meta/${resource}`
  try {
    const res = await fetchImpl(url)
    if (!res.ok) return null
    const json: unknown = await res.json()
    return parseFileEntrySnapshot(json)
  } catch {
    return null
  }
}

export function validateArity(
  kind: LineageKind,
  inputs: FileVersion[],
  outputs: FileVersion[],
): string | null {
  switch (kind) {
    case 'upload':
    case 'create':
      if (inputs.length !== 0) return `${kind} must have no inputs`
      if (outputs.length < 1) return `${kind} must have ≥1 output`
      return null
    case 'edit':
    case 'restore':
      if (inputs.length !== 1) return `${kind} must have exactly 1 input`
      if (outputs.length !== 1) return `${kind} must have exactly 1 output`
      return null
    case 'move':
    case 'rename':
    case 'copy':
      if (inputs.length !== 1) return `${kind} must have exactly 1 input`
      if (outputs.length !== 1) return `${kind} must have exactly 1 output`
      return null
    case 'delete':
      if (inputs.length !== 1) return 'delete must have exactly 1 input'
      if (outputs.length !== 0) return 'delete must have no outputs'
      return null
    case 'job':
      // Read-only / no-op jobs are valid (0 inputs and/or 0 outputs).
      return null
    default:
      return 'unknown kind'
  }
}

export function parseCommitIdFromJson(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const commit = (body as { commit?: { id?: unknown } }).commit
  if (commit && typeof commit.id === 'string' && commit.id.trim()) {
    return commit.id.trim()
  }
  return undefined
}

export function versionKey(v: FileVersion): string {
  return `${v.namespace}\0${v.repo}\0${v.path}\0${v.contentHash ?? ''}\0${v.commitId ?? ''}`
}

export function pathKey(v: Pick<FileVersion, 'namespace' | 'repo' | 'path'>): string {
  return `${v.namespace}\0${v.repo}\0${v.path}`
}

/**
 * Stable identity keys for a file version as a graph node / produced artifact.
 * Hash and commit aliases are registered together so explicit (commit-only) and
 * derived (hash+commit) ops collapse to one producer.
 */
export function fileVersionKeys(
  namespace: string,
  repo: string,
  v: Pick<FileVersion, 'path' | 'contentHash' | 'commitId'>,
): string[] {
  const keys: string[] = []
  if (v.contentHash) {
    keys.push(`${namespace}\0${repo}\0${v.path}\0h:${v.contentHash}`)
  }
  if (v.commitId) {
    keys.push(`${namespace}\0${repo}\0${v.path}\0c:${v.commitId}`)
  }
  if (keys.length === 0) {
    keys.push(`${namespace}\0${repo}\0${v.path}\0_`)
  }
  return keys
}

/** Primary key (hash preferred, else commit, else path). */
export function fileVersionKey(
  namespace: string,
  repo: string,
  v: Pick<FileVersion, 'path' | 'contentHash' | 'commitId'>,
): string {
  return fileVersionKeys(namespace, repo, v)[0]!
}

/** Deterministic id for derived ops so rebuild is idempotent. */
export function derivedOpId(
  kind: LineageKind,
  namespace: string,
  repo: string,
  inputs: FileVersion[],
  outputs: FileVersion[],
): string {
  const payload = [
    kind,
    namespace,
    repo,
    ...inputs.map((v) => fileVersionKey(namespace, repo, v)).sort(),
    '->',
    ...outputs.map((v) => fileVersionKey(namespace, repo, v)).sort(),
  ].join('|')
  const digest = createHash('sha256').update(payload).digest('hex').slice(0, 16)
  return `d${digest}`
}

function findOpById(id: string): LineageOp | undefined {
  return readAllOps().find((o) => o.id === id)
}

function preferProducer(cur: LineageOp | undefined, next: LineageOp): LineageOp {
  if (!cur) return next
  if (cur.source === 'derived' && next.source === 'explicit') return next
  return cur
}

/** Map each produced file-version key → producing op (explicit wins over derived). */
export function producerIndex(ops: LineageOp[]): Map<string, LineageOp> {
  const map = new Map<string, LineageOp>()
  const ordered = [...ops].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1
    if (a.source !== b.source) return a.source === 'explicit' ? -1 : 1
    return a.id < b.id ? -1 : 1
  })
  for (const op of ordered) {
    for (const out of op.outputs) {
      for (const key of fileVersionKeys(op.namespace, op.repo, out)) {
        map.set(key, preferProducer(map.get(key), op))
      }
    }
  }
  return map
}

function findProducer(
  producers: Map<string, LineageOp>,
  namespace: string,
  repo: string,
  v: Pick<FileVersion, 'path' | 'contentHash' | 'commitId'>,
): LineageOp | undefined {
  for (const key of fileVersionKeys(namespace, repo, v)) {
    const op = producers.get(key)
    if (op) return op
  }
  return undefined
}

function rewriteStore(ops: LineageOp[]): void {
  log.rewrite(ops)
}

/**
 * Ensure at most one producing op per file version for `path` in a repo.
 * Prefers explicit over derived; keeps the earliest winner. Returns removed count.
 */
export function pruneDuplicateProducers(
  namespace: string,
  repo: string,
  path?: string,
): { removed: number; kept: number } {
  const all = readAllOps()
  const inScope = (o: LineageOp) =>
    o.namespace === namespace &&
    o.repo === repo &&
    (!path ||
      o.inputs.some((v) => v.path === path) ||
      o.outputs.some((v) => v.path === path))

  const scoped = all.filter(inScope)
  const others = all.filter((o) => !inScope(o))
  const preferred = producerIndex(scoped)
  const keepIds = new Set<string>()
  for (const op of preferred.values()) keepIds.add(op.id)

  // Deletes (no outputs): keep one per input-version key + kind.
  const deleteSeen = new Set<string>()
  for (const op of [...scoped].sort((a, b) => (a.ts < b.ts ? -1 : 1))) {
    if (op.outputs.length > 0) continue
    const ik = op.inputs
      .map((v) => fileVersionKey(namespace, repo, v))
      .sort()
      .join('|')
    const dk = `${op.kind}|${ik}`
    if (deleteSeen.has(dk)) continue
    deleteSeen.add(dk)
    keepIds.add(op.id)
  }

  const keptScoped = scoped.filter((o) => keepIds.has(o.id))
  const removed = scoped.length - keptScoped.length
  if (removed > 0) {
    // Preserve global order: others + kept scoped in original relative order.
    const keepSet = new Set([
      ...others.map((o) => o.id),
      ...keptScoped.map((o) => o.id),
    ])
    rewriteStore(all.filter((o) => keepSet.has(o.id)))
  }
  return { removed, kept: keptScoped.length }
}

export function appendLineage(
  partial: Omit<LineageOp, 'id' | 'ts'> & { id?: string; ts?: string },
): LineageOp | null {
  const arityErr = validateArity(partial.kind, partial.inputs, partial.outputs)
  if (arityErr) {
    console.error('[mice-auth] lineage arity', arityErr, partial.kind)
    return null
  }

  if (partial.id) {
    const existing = findOpById(partial.id)
    if (existing) return existing
  }

  // Single-producer invariant: each file version has one producer.
  // Derived never stacks on an existing producer; explicit may supersede derived.
  // Exception: explicit restore may re-introduce the same content hash at a later
  // commit — hash aliases alone must not block recording that op.
  const producers = producerIndex(readAllOps())
  let supersedesDerived = false
  for (const out of partial.outputs) {
    const prior = findProducer(
      producers,
      partial.namespace,
      partial.repo,
      out,
    )
    if (!prior) continue
    if (
      partial.kind === 'restore' &&
      partial.source === 'explicit' &&
      out.commitId
    ) {
      // Idempotent only when this path@commit already has a producer.
      const commitKey = `${partial.namespace}\0${partial.repo}\0${out.path}\0c:${out.commitId}`
      const byCommit = producers.get(commitKey)
      if (byCommit) return byCommit
      continue
    }
    if (partial.source === 'derived') return prior
    if (prior.source === 'explicit') return prior
    supersedesDerived = true
  }

  const op: LineageOp = {
    id: partial.id ?? randomBytes(8).toString('hex'),
    ts: partial.ts ?? new Date().toISOString(),
    kind: partial.kind,
    namespace: partial.namespace,
    repo: partial.repo,
    inputs: partial.inputs,
    outputs: partial.outputs,
    source: partial.source,
    confidence: partial.confidence,
    ...(partial.branch ? { branch: partial.branch } : {}),
    ...(partial.actor ? { actor: partial.actor } : {}),
    ...(partial.via ? { via: partial.via } : {}),
    ...(partial.commitId ? { commitId: partial.commitId } : {}),
    ...(partial.auditEventId ? { auditEventId: partial.auditEventId } : {}),
    ...(partial.detail && Object.keys(partial.detail).length
      ? { detail: partial.detail }
      : {}),
  }
  try {
    log.append(op)
    if (supersedesDerived && partial.outputs[0]?.path) {
      pruneDuplicateProducers(
        partial.namespace,
        partial.repo,
        partial.outputs[0].path,
      )
    }
    return op
  } catch (err) {
    console.error('[mice-auth] lineage append failed', err)
    return null
  }
}

function readAllOps(): LineageOp[] {
  return log.readAll()
}

function versionMatchesFocus(
  v: FileVersion,
  focus: { path?: string; contentHash?: string },
): boolean {
  if (focus.contentHash && v.contentHash === focus.contentHash) return true
  if (focus.path && v.path === focus.path) return true
  return false
}

function opTouchesFocus(
  op: LineageOp,
  focus: { path?: string; contentHash?: string },
): boolean {
  return (
    op.inputs.some((v) => versionMatchesFocus(v, focus)) ||
    op.outputs.some((v) => versionMatchesFocus(v, focus))
  )
}

/** Build a subgraph around a path and/or content hash. */
export function queryLineage(q: LineageQuery): {
  operations: LineageOp[]
  nextCursor: string | null
} {
  const limit = Math.min(Math.max(1, q.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const depth = Math.min(Math.max(1, q.depth ?? DEFAULT_DEPTH), MAX_DEPTH)
  const direction = q.direction ?? 'both'

  let ops = readAllOps().filter(
    (o) => o.namespace === q.namespace && o.repo === q.repo,
  )

  if (q.kind) ops = ops.filter((o) => o.kind === q.kind)
  if (q.jobId) {
    const jobId = q.jobId
    ops = ops.filter(
      (o) =>
        o.kind === 'job' &&
        o.detail &&
        typeof o.detail.job_id === 'string' &&
        o.detail.job_id === jobId,
    )
  }
  if (q.commit) {
    const commit = q.commit
    ops = ops.filter(
      (o) =>
        o.commitId === commit ||
        o.detail?.pin_commit === commit ||
        o.detail?.result_commit === commit ||
        o.inputs.some((v) => v.commitId === commit) ||
        o.outputs.some((v) => v.commitId === commit),
    )
  }
  if (q.since) {
    const since = q.since
    ops = ops.filter((o) => o.ts >= since)
  }
  if (q.until) {
    const until = q.until
    ops = ops.filter((o) => o.ts <= until)
  }

  const focus =
    q.path || q.contentHash
      ? { path: q.path, contentHash: q.contentHash }
      : null

  if (focus) {
    const seed = ops.filter((o) => opTouchesFocus(o, focus))
    const selected = new Map<string, LineageOp>()
    for (const o of seed) selected.set(o.id, o)

    // BFS over version keys
    type Node = { path: string; contentHash?: string; d: number }
    const queue: Node[] = []
    const seen = new Set<string>()

    for (const o of seed) {
      for (const v of [...o.inputs, ...o.outputs]) {
        if (!versionMatchesFocus(v, focus)) continue
        const k = `${v.path}\0${v.contentHash ?? ''}`
        if (!seen.has(k)) {
          seen.add(k)
          queue.push({ path: v.path, contentHash: v.contentHash, d: 0 })
        }
      }
    }
    if (q.path && !seen.has(`${q.path}\0`)) {
      seen.add(`${q.path}\0`)
      queue.push({ path: q.path, d: 0 })
    }

    while (queue.length) {
      const cur = queue.shift()!
      if (cur.d >= depth) continue
      for (const op of ops) {
        const asOut = op.outputs.some(
          (v) =>
            v.path === cur.path &&
            (!cur.contentHash ||
              !v.contentHash ||
              v.contentHash === cur.contentHash),
        )
        const asIn = op.inputs.some(
          (v) =>
            v.path === cur.path &&
            (!cur.contentHash ||
              !v.contentHash ||
              v.contentHash === cur.contentHash),
        )

        const walkAncestors =
          (direction === 'ancestors' || direction === 'both') && asOut
        const walkDescendants =
          (direction === 'descendants' || direction === 'both') && asIn

        if (!walkAncestors && !walkDescendants) {
          // Also include op if it touches this node at all when direction both
          if (
            direction === 'both' &&
            (asIn || asOut) &&
            !selected.has(op.id)
          ) {
            selected.set(op.id, op)
          }
          continue
        }

        if (!selected.has(op.id)) selected.set(op.id, op)

        const nextVers =
          walkAncestors && walkDescendants
            ? [...op.inputs, ...op.outputs]
            : walkAncestors
              ? op.inputs
              : op.outputs

        for (const v of nextVers) {
          const k = `${v.path}\0${v.contentHash ?? ''}`
          if (seen.has(k)) continue
          seen.add(k)
          queue.push({
            path: v.path,
            contentHash: v.contentHash,
            d: cur.d + 1,
          })
        }
      }
    }

    ops = [...selected.values()]
  }

  // Newest first
  ops.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))

  if (q.cursor) {
    const idx = ops.findIndex((o) => o.id === q.cursor)
    if (idx >= 0) ops = ops.slice(idx + 1)
  }

  const page = ops.slice(0, limit)
  const nextCursor =
    page.length === limit && ops.length > limit
      ? (page[page.length - 1]?.id ?? null)
      : null

  return { operations: page, nextCursor }
}

export type PathVersionHint = {
  path: string
  contentHash?: string
  commitId?: string
  ts?: string
}

/**
 * Derive upload + edit chain for a single path from ordered versions
 * (oldest → newest). Idempotent: each file version has at most one producer;
 * re-running rebuild does not create duplicates.
 */
export function deriveOpsFromPathHistory(
  namespace: string,
  repo: string,
  branch: string | undefined,
  versionsOldestFirst: PathVersionHint[],
): LineageOp[] {
  const focusPath =
    versionsOldestFirst.find((v) => v.path)?.path ?? undefined
  pruneDuplicateProducers(namespace, repo, focusPath)

  const knownIds = new Set(readAllOps().map((o) => o.id))
  const producers = producerIndex(
    readAllOps().filter((o) => o.namespace === namespace && o.repo === repo),
  )

  const created: LineageOp[] = []
  let prev: PathVersionHint | undefined

  for (const cur of versionsOldestFirst) {
    if (!cur.path) continue
    const outRef: FileVersion = {
      namespace,
      repo,
      path: cur.path,
      ...(cur.contentHash ? { contentHash: cur.contentHash } : {}),
      ...(cur.commitId ? { commitId: cur.commitId } : {}),
    }
    if (findProducer(producers, namespace, repo, outRef)) {
      prev = cur
      continue
    }

    const inputs: FileVersion[] = prev
      ? [
          {
            namespace,
            repo,
            path: prev.path,
            ...(prev.contentHash ? { contentHash: prev.contentHash } : {}),
            ...(prev.commitId ? { commitId: prev.commitId } : {}),
          },
        ]
      : []
    const outputs = [outRef]
    const kind: LineageKind = prev ? 'edit' : 'upload'
    const id = derivedOpId(kind, namespace, repo, inputs, outputs)
    const op = appendLineage({
      id,
      kind,
      namespace,
      repo,
      branch,
      inputs,
      outputs,
      ...(cur.commitId ? { commitId: cur.commitId } : {}),
      source: 'derived',
      confidence: 'high',
      ...(cur.ts ? { ts: cur.ts } : {}),
      detail: { derivedFrom: 'path_history' },
    })

    if (op) {
      for (const key of fileVersionKeys(namespace, repo, outRef)) {
        producers.set(key, preferProducer(producers.get(key), op))
      }
      if (!knownIds.has(op.id)) {
        knownIds.add(op.id)
        created.push(op)
      }
    }
    prev = cur
  }

  return created
}

/**
 * Heuristic: same hash removed+added in one commit → low-confidence
 * rename (same parent) or move (different parent).
 */
export function deriveMoveHeuristic(opts: {
  namespace: string
  repo: string
  branch?: string
  commitId: string
  oldPath: string
  newPath: string
  contentHash?: string
  ts?: string
}): LineageOp | null {
  const kind = pathChangeKind(opts.oldPath, opts.newPath)
  const inputs: FileVersion[] = [
    {
      namespace: opts.namespace,
      repo: opts.repo,
      path: opts.oldPath,
      ...(opts.contentHash ? { contentHash: opts.contentHash } : {}),
      commitId: opts.commitId,
    },
  ]
  const outputs: FileVersion[] = [
    {
      namespace: opts.namespace,
      repo: opts.repo,
      path: opts.newPath,
      ...(opts.contentHash ? { contentHash: opts.contentHash } : {}),
      commitId: opts.commitId,
    },
  ]
  const id = derivedOpId(kind, opts.namespace, opts.repo, inputs, outputs)
  const known = findOpById(id)
  if (known) return known

  return appendLineage({
    id,
    kind,
    namespace: opts.namespace,
    repo: opts.repo,
    branch: opts.branch,
    inputs,
    outputs,
    commitId: opts.commitId,
    source: 'derived',
    confidence: 'low',
    ...(opts.ts ? { ts: opts.ts } : {}),
    detail: { derivedFrom: 'path_change_heuristic' },
  })
}

/**
 * Heuristic: in a single commit, hash appears at a new path while the source
 * path that already held that hash was not removed → low-confidence copy.
 */
export function deriveCopyHeuristic(opts: {
  namespace: string
  repo: string
  branch?: string
  commitId: string
  sourcePath: string
  newPath: string
  contentHash: string
  /** When true, this is a move/rename — refuse to record a copy. */
  sourceRemoved?: boolean
  ts?: string
}): LineageOp | null {
  const sourcePath = normPath(opts.sourcePath)
  const newPath = normPath(opts.newPath)
  const contentHash = opts.contentHash.trim()
  if (!sourcePath || !newPath || !contentHash) return null
  if (sourcePath === newPath) return null
  if (opts.sourceRemoved) return null
  if (pathBaseName(sourcePath) !== pathBaseName(newPath)) return null

  const inputs: FileVersion[] = [
    {
      namespace: opts.namespace,
      repo: opts.repo,
      path: sourcePath,
      contentHash,
      commitId: opts.commitId,
    },
  ]
  const outputs: FileVersion[] = [
    {
      namespace: opts.namespace,
      repo: opts.repo,
      path: newPath,
      contentHash,
      commitId: opts.commitId,
    },
  ]
  const id = derivedOpId('copy', opts.namespace, opts.repo, inputs, outputs)
  const known = findOpById(id)
  if (known) return known

  return appendLineage({
    id,
    kind: 'copy',
    namespace: opts.namespace,
    repo: opts.repo,
    branch: opts.branch,
    inputs,
    outputs,
    commitId: opts.commitId,
    source: 'derived',
    confidence: 'low',
    ...(opts.ts ? { ts: opts.ts } : {}),
    detail: { derivedFrom: 'copy_heuristic' },
  })
}

/**
 * Apply copy heuristics for one commit using its add/remove set and the
 * base-tree hash index. Skips pairs that look like move/rename (source removed).
 */
export function deriveCopiesFromCommitDiff(opts: {
  namespace: string
  repo: string
  branch?: string
  commitId: string
  added: CommitDiffPath[]
  removedPaths: Iterable<string>
  basePathsByHash: Map<string, string[]>
  ts?: string
}): LineageOp[] {
  const pairs = inferCopyPairs({
    added: opts.added,
    removedPaths: opts.removedPaths,
    basePathsByHash: opts.basePathsByHash,
  })
  const created: LineageOp[] = []
  for (const pair of pairs) {
    const op = deriveCopyHeuristic({
      namespace: opts.namespace,
      repo: opts.repo,
      branch: opts.branch,
      commitId: opts.commitId,
      sourcePath: pair.sourcePath,
      newPath: pair.newPath,
      contentHash: pair.contentHash,
      sourceRemoved: false,
      ts: opts.ts,
    })
    if (op && !created.some((c) => c.id === op.id)) created.push(op)
  }
  return created
}

export function buildExplicitFileOp(opts: {
  kind: LineageKind
  namespace: string
  repo: string
  branch?: string
  path?: string
  newPath?: string
  commitId?: string
  actor: AuditActor
  via: AuditVia
  auditEventId?: string
  contentHash?: string
  /** Prior version at the same path (edit) or source path (move/copy/delete). */
  priorContentHash?: string
  priorCommitId?: string
}): LineageOp | null {
  const { kind, namespace, repo } = opts
  const outBase = {
    namespace,
    repo,
    ...(opts.contentHash ? { contentHash: opts.contentHash } : {}),
    ...(opts.commitId ? { commitId: opts.commitId } : {}),
  }
  const priorBase = {
    namespace,
    repo,
    ...(opts.priorContentHash
      ? { contentHash: opts.priorContentHash }
      : opts.contentHash &&
          (kind === 'move' ||
            kind === 'rename' ||
            kind === 'copy' ||
            kind === 'delete')
        ? { contentHash: opts.contentHash }
        : {}),
    ...(opts.priorCommitId ? { commitId: opts.priorCommitId } : {}),
  }

  let inputs: FileVersion[] = []
  let outputs: FileVersion[] = []

  if (kind === 'upload' || kind === 'create') {
    if (!opts.path) return null
    outputs = [{ ...outBase, path: opts.path }]
  } else if (kind === 'delete') {
    if (!opts.path) return null
    inputs = [{ ...priorBase, path: opts.path }]
  } else if (kind === 'move' || kind === 'rename' || kind === 'copy') {
    if (!opts.path || !opts.newPath) return null
    inputs = [{ ...priorBase, path: opts.path }]
    outputs = [{ ...outBase, path: opts.newPath }]
  } else if (kind === 'edit' || kind === 'restore') {
    if (!opts.path) return null
    // Require a prior version signal (hash and/or commit) so the op is attributable.
    if (!opts.priorContentHash && !opts.priorCommitId) return null
    inputs = [
      {
        namespace,
        repo,
        path: opts.path,
        ...(opts.priorContentHash
          ? { contentHash: opts.priorContentHash }
          : {}),
        ...(opts.priorCommitId ? { commitId: opts.priorCommitId } : {}),
      },
    ]
    outputs = [{ ...outBase, path: opts.path }]
  } else {
    return null
  }

  return appendLineage({
    kind,
    namespace,
    repo,
    branch: opts.branch,
    inputs,
    outputs,
    actor: opts.actor,
    via: opts.via,
    commitId: opts.commitId,
    auditEventId: opts.auditEventId,
    source: 'explicit',
    confidence: 'high',
  })
}
