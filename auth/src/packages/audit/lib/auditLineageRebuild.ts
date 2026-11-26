import { env } from '../../shared/index.js'
import { deriveOpsFromPathHistory, PathVersionHint } from '../../namespaces/index.js'

type VersionRow = {
  commit?: { id?: string; timestamp?: string }
  resource?: { path?: string; version?: string }
}
type HistoryRow = {
  id?: string
  timestamp?: string
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const upstream = await fetch(url)
    let json: unknown = null
    try {
      json = await upstream.json()
    } catch {
      json = null
    }
    return { ok: upstream.ok, status: upstream.status, json }
  } catch (err) {
    console.error('[mice-auth] lineage rebuild fetch failed', err)
    return { ok: false, status: 502, json: null }
  }
}

/**
 * Pull oxen path-version / commit history and derive lineage operations.
 * Returns created ops or an upstream error for the HTTP adapter to map.
 */
export async function rebuildLineageFromOxen(input: {
  namespace: string
  repo: string
  branch: string
  path: string
}): Promise<
  | { ok: true; created: Awaited<ReturnType<typeof deriveOpsFromPathHistory>> }
  | { ok: false; error: string; status: 502 }
> {
  const { namespace, repo, path, branch } = input
  const resource = path
    .split('/')
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join('/')
  const repoApi = `${env.oxenUpstream}/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`
  const looksLikeCommitId = /^[0-9a-f]{16,64}$/i.test(branch)
  const branchVersionsUrl = `${repoApi}/branches/${encodeURIComponent(branch)}/versions/${resource}?page=1&page_size=100`
  const historyUrl = `${repoApi}/commits/history/${[branch, ...path.split('/').filter(Boolean)].map(encodeURIComponent).join('/')}?page=1&page_size=100`

  let hints: PathVersionHint[] = []
  if (!looksLikeCommitId) {
    const branchRes = await fetchJson(branchVersionsUrl)
    if (branchRes.ok && branchRes.json && typeof branchRes.json === 'object') {
      const rows = (branchRes.json as { versions?: VersionRow[] }).versions ?? []
      // API returns newest-first typically; normalize to oldest-first.
      hints = rows
        .map((v) => ({
          path: v.resource?.path || path,
          contentHash: v.resource?.version,
          commitId: v.commit?.id,
          ts: v.commit?.timestamp,
        }))
        .reverse()
    } else if (branchRes.status !== 404 && branchRes.status !== 400) {
      return { ok: false, error: `oxen versions failed (${branchRes.status})`, status: 502 }
    }
  }

  if (hints.length === 0) {
    const histRes = await fetchJson(historyUrl)
    if (!histRes.ok) {
      return { ok: false, error: `oxen versions failed (${histRes.status})`, status: 502 }
    }
    if (!histRes.json || typeof histRes.json !== 'object') {
      return { ok: false, error: 'Invalid oxen versions response', status: 502 }
    }
    const commits = (histRes.json as { commits?: HistoryRow[] }).commits ?? []
    hints = commits
      .map((commit) => ({
        path,
        commitId: commit.id,
        ts: commit.timestamp,
      }))
      .reverse()
  }

  const created = await deriveOpsFromPathHistory(namespace, repo, branch, hints)
  return { ok: true, created }
}
