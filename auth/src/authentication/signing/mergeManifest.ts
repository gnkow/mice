import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeCommitClone } from '../../jobsOxen.js'

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
 * Resolve (and cache) the merge-result manifest for a commit tip.
 * The digest is the authoritative content evidence for a signature binding.
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
