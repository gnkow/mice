import { env } from '../../shared/index.js'

const repoCache = new Map<string, { at: number; ok: boolean }>()
const TTL_MS = 15_000

export async function oxenJson(path: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(`${env.oxenUpstream}${path}`, { redirect: 'manual' })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* not json */
    }
    return { status: res.status, body }
  } catch {
    return null
  }
}

export async function repoExists(ns: string, repo: string): Promise<boolean> {
  const key = `${ns}/${repo}`
  const hit = repoCache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok
  const r = await oxenJson(
    `/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}`,
  )
  // Only an explicit 404 means "missing"; upstream errors must not block edits.
  const ok = !(r && r.status === 404)
  repoCache.set(key, { at: Date.now(), ok })
  return ok
}
