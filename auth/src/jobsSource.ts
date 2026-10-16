import { env } from './env.js'

export type ParsedSource =
  | { kind: 'branch_commit'; branch: string; commit: string }
  | { kind: 'branch'; branch: string }
  | { kind: 'commit'; commit: string }

export type ResolvedSource = {
  /** Canonical `branch:commit` */
  source_ref: string
  branch: string
  pin_commit: string
}

/** Oxen commit ids are lowercase hex (typically 32 chars). */
export function looksLikeCommitId(ref: string): boolean {
  return /^[0-9a-f]{16,64}$/i.test(ref.trim())
}

/**
 * Parse `--source` / submit `source`:
 * - `main:87149f…` → branch + commit
 * - `main` → branch tip (resolve later)
 * - `87149f…` → commit only (resolve branch later)
 */
export function parseSourceSpec(raw: string): ParsedSource | { error: string } {
  const s = raw.trim()
  if (!s) return { error: 'source is empty' }

  const colon = s.indexOf(':')
  if (colon > 0) {
    const branch = s.slice(0, colon).trim()
    const commit = s.slice(colon + 1).trim()
    if (!branch) return { error: 'source branch before ":" is empty' }
    if (!commit || !looksLikeCommitId(commit)) {
      return { error: 'source after ":" must be a commit id' }
    }
    return { kind: 'branch_commit', branch, commit }
  }

  if (looksLikeCommitId(s)) return { kind: 'commit', commit: s }
  return { kind: 'branch', branch: s }
}

async function oxenJson(path: string): Promise<unknown> {
  const url = `${env.oxenUpstream}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`oxen ${path} failed (${res.status})`)
  }
  return res.json()
}

function enc(s: string): string {
  return encodeURIComponent(s)
}

async function listBranches(
  namespace: string,
  repo: string,
): Promise<Array<{ name: string; commit_id: string }>> {
  const body = (await oxenJson(
    `/api/repos/${enc(namespace)}/${enc(repo)}/branches`,
  )) as { branches?: Array<{ name?: string; commit_id?: string }> }
  return (body.branches ?? [])
    .filter((b) => b.name && b.commit_id)
    .map((b) => ({ name: b.name!, commit_id: b.commit_id! }))
}

async function getCommitId(
  namespace: string,
  repo: string,
  revision: string,
): Promise<string> {
  const body = (await oxenJson(
    `/api/repos/${enc(namespace)}/${enc(repo)}/commits/${enc(revision)}`,
  )) as { commit?: { id?: string } }
  const id = body.commit?.id?.trim()
  if (!id) throw new Error(`commit not found: ${revision}`)
  return id
}

/**
 * Resolve a source spec to branch + pin commit.
 * `targetHint` is used when source is commit-only (prefer that branch if it
 * contains / points at the commit).
 */
export async function resolveSource(
  namespace: string,
  repo: string,
  spec: ParsedSource,
  targetHint?: string,
): Promise<ResolvedSource> {
  if (spec.kind === 'branch_commit') {
    const pin = await getCommitId(namespace, repo, spec.commit)
    return {
      source_ref: `${spec.branch}:${pin}`,
      branch: spec.branch,
      pin_commit: pin,
    }
  }

  if (spec.kind === 'branch') {
    const branches = await listBranches(namespace, repo)
    const hit = branches.find((b) => b.name === spec.branch)
    if (!hit) throw new Error(`branch not found: ${spec.branch}`)
    const pin = hit.commit_id
    return {
      source_ref: `${spec.branch}:${pin}`,
      branch: spec.branch,
      pin_commit: pin,
    }
  }

  // commit-only → find a branch
  const pin = await getCommitId(namespace, repo, spec.commit)
  const branches = await listBranches(namespace, repo)
  const tipMatch = branches.filter((b) => b.commit_id === pin)
  if (targetHint) {
    const t = tipMatch.find((b) => b.name === targetHint)
    if (t) {
      return { source_ref: `${t.name}:${pin}`, branch: t.name, pin_commit: pin }
    }
    // Prefer target even if tip differs (commit is ancestor on that line).
    if (branches.some((b) => b.name === targetHint)) {
      return {
        source_ref: `${targetHint}:${pin}`,
        branch: targetHint,
        pin_commit: pin,
      }
    }
  }
  if (tipMatch.length === 1) {
    return {
      source_ref: `${tipMatch[0]!.name}:${pin}`,
      branch: tipMatch[0]!.name,
      pin_commit: pin,
    }
  }
  if (tipMatch.length > 1) {
    throw new Error(
      `commit ${pin.slice(0, 12)} is tip of multiple branches (${tipMatch
        .map((b) => b.name)
        .join(', ')}); pass --source <branch>:${pin.slice(0, 12)}` +
        (targetHint ? '' : ' (or pass --source <branch>:<commit>)'),
    )
  }
  if (targetHint) {
    return {
      source_ref: `${targetHint}:${pin}`,
      branch: targetHint,
      pin_commit: pin,
    }
  }
  throw new Error(
    `commit ${pin.slice(0, 12)} is not the tip of any branch; pass --source <branch>:${pin.slice(0, 12)}`,
  )
}

export function formatSourceRef(branch: string, pin: string): string {
  return `${branch}:${pin}`
}
