import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeCommitClone } from '../../../jobs/index.js'

export type ManifestEntry = {
  path: string
  contentHash: string
}

export type MergeManifest = {
  /** Canonical per-file digest list: `path hash\n` sorted by path. */
  manifest: string
  /** SHA-256 hex of `manifest`. */
  digest: string
}

export type RepoRef = { namespace: string; repo: string }

export type TreeLister = (
  namespace: string,
  repo: string,
  commit: string,
) => Promise<ManifestEntry[]>

export type ManifestCache = {
  get(key: string): MergeManifest | undefined
  set(key: string, value: MergeManifest): void
}

export type ManifestForCommitOptions = {
  listTree?: TreeLister
  cache?: ManifestCache
}

/**
 * Build the merge-result SHA-256 manifest from a flat list of file digests.
 * Commit ids are not part of this evidence; the digest is the binding content hash.
 */
export function buildMergeManifest(entries: ManifestEntry[]): MergeManifest {
  const lines = [...entries]
    .map((e) => ({ path: e.path.replace(/^\/+/, ''), contentHash: e.contentHash.trim() }))
    .filter((e) => e.path && e.contentHash)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const manifest = lines.map((e) => `${e.path} ${e.contentHash}`).join('\n')
  const body = lines.length === 0 ? '' : `${manifest}\n`
  return {
    manifest: body,
    digest: createHash('sha256').update(body, 'utf8').digest('hex'),
  }
}

/** Process-local incremental cache keyed by namespace/repo/commit. */
export function createManifestCache(): ManifestCache {
  const map = new Map<string, MergeManifest>()
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value)
    },
  }
}

const defaultCache = createManifestCache()

function cacheKey(repo: RepoRef, commit: string): string {
  return `${repo.namespace}\0${repo.repo}\0${commit}`
}

/**
 * Materialize the commit tree and SHA-256 each file. Oxen entry hashes are not
 * SHA-256, so content must be hashed locally for the binding digest.
 */
export async function listCommitTree(
  namespace: string,
  repo: string,
  commit: string,
): Promise<ManifestEntry[]> {
  const dir = mkdtempSync(join(tmpdir(), 'mice-manifest-'))
  try {
    const hashes = await materializeCommitClone(namespace, repo, commit, dir)
    return [...hashes.entries()].map(([path, contentHash]) => ({ path, contentHash }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Resolve (and cache) the per-commit tree manifest.
 * Pair this with {@link manifestForMergeResult} for the binding content evidence.
 */
export async function manifestForCommit(
  repo: RepoRef,
  commit: string,
  opts: ManifestForCommitOptions = {},
): Promise<MergeManifest> {
  const listTree = opts.listTree ?? listCommitTree
  const cache = opts.cache ?? defaultCache
  const key = cacheKey(repo, commit)
  const hit = cache.get(key)
  if (hit) return hit
  const built = buildMergeManifest(await listTree(repo.namespace, repo.repo, commit))
  cache.set(key, built)
  return built
}

function entriesFromManifest(manifest: string): ManifestEntry[] {
  return manifest
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const sp = line.lastIndexOf(' ')
      return { path: line.slice(0, sp), contentHash: line.slice(sp + 1) }
    })
}

/**
 * Merge-result file set: target tree, then source overlays shared paths.
 * Models the tree that lands when source is merged into target (additive + theirs-wins).
 */
export function mergeResultEntries(
  target: ManifestEntry[],
  source: ManifestEntry[],
): ManifestEntry[] {
  const map = new Map<string, string>()
  for (const e of target) {
    const path = e.path.replace(/^\/+/, '')
    const hash = e.contentHash.trim()
    if (path && hash) map.set(path, hash)
  }
  for (const e of source) {
    const path = e.path.replace(/^\/+/, '')
    const hash = e.contentHash.trim()
    if (path && hash) map.set(path, hash)
  }
  return [...map.entries()].map(([path, contentHash]) => ({ path, contentHash }))
}

function mergePairKey(repo: RepoRef, sourceHead: string, targetHead: string): string {
  return `${repo.namespace}\0${repo.repo}\0merge\0${sourceHead}\0${targetHead}`
}

/**
 * SHA-256 manifest of the merge result (target tree overlaid by source), incrementally
 * cached per tip pair. Per-commit trees reuse {@link manifestForCommit}'s cache.
 */
export async function manifestForMergeResult(
  repo: RepoRef,
  sourceHead: string,
  targetHead: string,
  opts: ManifestForCommitOptions = {},
): Promise<MergeManifest> {
  const cache = opts.cache ?? defaultCache
  const pairKey = mergePairKey(repo, sourceHead, targetHead)
  const hit = cache.get(pairKey)
  if (hit) return hit

  const [source, target] = await Promise.all([
    manifestForCommit(repo, sourceHead, opts),
    manifestForCommit(repo, targetHead, opts),
  ])
  const built = buildMergeManifest(
    mergeResultEntries(entriesFromManifest(target.manifest), entriesFromManifest(source.manifest)),
  )
  cache.set(pairKey, built)
  return built
}

export type MergeResultBinding = {
  repo: string
  sourceHead: string
  targetHead: string
  /** SHA-256 of the merge-result manifest text — the binding content evidence. */
  manifestDigest: string
}

/**
 * Pair a computed merge manifest with tip ids for signature binding.
 * Heads identify the merge; only `manifestDigest` is authoritative content evidence.
 */
export function mergeResultBinding(input: {
  repo: string
  sourceHead: string
  targetHead: string
  merge: MergeManifest
}): { binding: MergeResultBinding; manifest: string } {
  return {
    binding: {
      repo: input.repo,
      sourceHead: input.sourceHead,
      targetHead: input.targetHead,
      manifestDigest: input.merge.digest,
    },
    manifest: input.merge.manifest,
  }
}
