import { env } from '../../shared/index.js'
import { authorsFromCommits } from '../../merge/index.js'

let upstreamFetch: typeof fetch = (input, init) => fetch(input, init)

/** Swap the upstream transport (tests); returns a function restoring the previous one. */
export function setUpstreamFetch(next: typeof fetch): () => void {
  const prev = upstreamFetch
  upstreamFetch = next
  return () => {
    upstreamFetch = prev
  }
}

export function getUpstreamFetch(): typeof fetch {
  return upstreamFetch
}

/** Commits that would enter the merge; fail closed when oxen cannot answer. */
export async function loadMergeAuthors(
  pathname: string,
  headers: Headers,
): Promise<{ ok: true; authors: string[] } | { ok: false }> {
  try {
    const res = await upstreamFetch(`${env.oxenUpstream}${pathname}`, {
      method: 'GET',
      headers,
      redirect: 'manual',
    })
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      return { ok: false }
    }
    const body = (await res.json()) as { commits?: unknown }
    if (!Array.isArray(body.commits)) return { ok: false }
    return { ok: true, authors: authorsFromCommits(body.commits as { author?: unknown }[]) }
  } catch {
    return { ok: false }
  }
}
