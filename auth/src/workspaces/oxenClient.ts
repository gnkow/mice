import { Readable } from 'node:stream'
import { env } from '../env.js'

export type OxenEntry = {
  name: string
  isDir: boolean
  /** Oxen hash: directory hash for dirs, xxh3-128 content hash (not zero padded) for files. */
  hash: string
  size: number
  /** Raw Oxen data_type; 'symlink' and unknown values are skipped by the store. */
  dataType: string
}

export type OxenListing = {
  /** Hash of the listed directory itself. */
  hash: string
  /** Recursive byte size reported by Oxen for the listed directory. */
  size: number | null
  entries: OxenEntry[]
}

/** Failure talking to Oxen. `retryable` = network/5xx (workspace stays `preparing`). */
export class OxenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'OxenError'
  }
}

/** The only surface the checkout store needs; tests inject a fake. */
export interface OxenClient {
  /** Branch name or commit id → full commit id. */
  resolveCommit(ns: string, repo: string, ref: string): Promise<string>
  /** One directory of a commit, all pages merged. Path '' = root. */
  listDir(ns: string, repo: string, commit: string, path: string): Promise<OxenListing>
  openFile(ns: string, repo: string, commit: string, path: string): Promise<Readable>
}

const enc = encodeURIComponent

/** Keep `/` inside branch names / paths; encode every segment. */
function resource(rev: string, path = ''): string {
  const parts = [...rev.split('/'), ...path.split('/')].filter(Boolean)
  return parts.map(enc).join('/')
}

export function httpOxenClient(
  fetchImpl: typeof fetch = fetch,
  base: () => string = () => env.oxenUpstream,
): OxenClient {
  async function call(path: string): Promise<Response> {
    let res: Response
    try {
      res = await fetchImpl(`${base()}${path}`)
    } catch (err) {
      throw new OxenError(`oxen unreachable: ${err instanceof Error ? err.message : err}`, 0, true)
    }
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429
      await res.body?.cancel().catch(() => undefined)
      throw new OxenError(`oxen ${res.status} for ${path.split('?')[0]}`, res.status, retryable)
    }
    return res
  }
  const repoBase = (ns: string, repo: string) => `/api/repos/${enc(ns)}/${enc(repo)}`

  return {
    async resolveCommit(ns, repo, ref) {
      const res = await call(`${repoBase(ns, repo)}/revisions/${resource(ref)}`)
      const body = (await res.json()) as { resource?: { commit?: { id?: string } } }
      const id = body.resource?.commit?.id
      if (!id) throw new OxenError(`revision ${ref} did not resolve to a commit`, 404, false)
      return id
    },

    async listDir(ns, repo, commit, path) {
      const entries: OxenEntry[] = []
      let hash = ''
      let size: number | null = null
      for (let page = 1; ; page += 1) {
        const res = await call(
          `${repoBase(ns, repo)}/dir/${resource(commit, path)}?page=${page}&page_size=1000`,
        )
        const body = (await res.json()) as {
          dir?: { hash?: string; size?: number }
          entries?: Array<{
            filename?: string
            hash?: string
            is_dir?: boolean
            size?: number
            data_type?: string
          }>
          total_pages?: number
        }
        if (page === 1) {
          hash = body.dir?.hash ?? ''
          size = typeof body.dir?.size === 'number' ? body.dir.size : null
        }
        for (const e of body.entries ?? []) {
          entries.push({
            name: e.filename ?? '',
            isDir: !!e.is_dir,
            hash: e.hash ?? '',
            size: typeof e.size === 'number' ? e.size : 0,
            dataType: e.data_type ?? '',
          })
        }
        if (page >= (body.total_pages ?? 1)) break
      }
      return { hash, size, entries }
    },

    async openFile(ns, repo, commit, path) {
      const res = await call(`${repoBase(ns, repo)}/file/${resource(commit, path)}`)
      if (!res.body) throw new OxenError(`empty body for ${path}`, 502, true)
      return Readable.fromWeb(res.body as never)
    },
  }
}
