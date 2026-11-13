import { env } from './env.js'

/** Actions that change a dataset version (base/head worth capturing). */
export const VERSIONED_ACTIONS = new Set([
  'file.write',
  'file.delete',
  'commit.publish',
  'merge',
  'branch.create',
  'branch.update',
  'workspace.commit',
  'workspace.merge',
])

export type DatasetVersions = {
  dataset?: { base?: string; head?: string }
  unverified?: true
}

export type DatasetTarget = {
  namespace?: string
  repo?: string
  branch?: string
  publishedCommit?: string
}

export type DatasetCapture = {
  /** Reads the branch head the mutation starts from; never throws. */
  before(): Promise<void>
  /** The versions for an answered mutation: nothing for a refusal, `unverified` when the new head is unknown. */
  after(upstream: Response, text: string | undefined): DatasetVersions
}

const decode = (v: string | undefined): string | undefined => {
  if (v === undefined) return undefined
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/** Target branch and (for a publish) the commit named by an oxen API path. */
export function datasetTarget(pathname: string): DatasetTarget {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'repos' || parts.length < 4) return {}
  const [namespace, repo] = [decode(parts[2]), decode(parts[3])]
  const rest = parts.slice(4)
  if (rest[0] === 'file' || rest[0] === 'branches') return { namespace, repo, branch: decode(rest[1]) }
  if (rest[0] === 'merge' || rest[0] === 'merges') {
    return { namespace, repo, branch: decode(rest[1]?.split('..')[0]) }
  }
  if (rest[0] === 'workspaces' && (rest[2] === 'commit' || rest[2] === 'merge')) {
    return { namespace, repo, branch: decode(rest[3]) }
  }
  if (rest[0] === 'commits' && rest[2] === 'complete') {
    return { namespace, repo, publishedCommit: decode(rest[1]) }
  }
  return { namespace, repo }
}

/** Head commit id stated by an oxen JSON answer (commit, branch tip, or merge result). */
export function headFromAnswer(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  let body: {
    commit?: { id?: unknown }
    branch?: { commit_id?: unknown }
    commits?: { merge?: { id?: unknown } }
  }
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  for (const id of [body?.commit?.id, body?.branch?.commit_id, body?.commits?.merge?.id]) {
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return undefined
}

/**
 * Build `{base, head}` / unverified from already-observed values.
 * Pure seam for unit tests and for `createDatasetCapture.after`.
 */
export function buildDatasetVersions(opts: {
  applies: boolean
  upstreamOk: boolean
  base?: string
  head?: string
}): DatasetVersions {
  if (!opts.applies || !opts.upstreamOk) return {}
  const dataset = {
    ...(opts.base ? { base: opts.base } : {}),
    ...(opts.head ? { head: opts.head } : {}),
  }
  return {
    ...(Object.keys(dataset).length ? { dataset } : {}),
    ...(opts.head ? {} : { unverified: true as const }),
  }
}

/**
 * The dataset version before and after a dataset mutation, so an auditor can reconstruct the data
 * state. The head is only what the upstream answer states (or the commit a publish names); it is
 * never guessed from the branch tip afterwards, as that could belong to someone else's change.
 */
export function createDatasetCapture(opts: {
  method: string
  pathname: string
  action: string
  fetchImpl?: typeof fetch
  oxenUpstream?: string
}): DatasetCapture {
  const applies = VERSIONED_ACTIONS.has(opts.action)
  const target = datasetTarget(opts.pathname)
  const upstreamBase = opts.oxenUpstream ?? env.oxenUpstream
  let base: string | undefined

  return {
    async before() {
      if (!applies || !target.namespace || !target.repo || !target.branch) return
      const url = `${upstreamBase}/api/repos/${encodeURIComponent(target.namespace)}/${encodeURIComponent(target.repo)}/branches/${encodeURIComponent(target.branch)}`
      try {
        const res = await (opts.fetchImpl ?? fetch)(url)
        if (!res.ok) return
        const id = ((await res.json()) as { branch?: { commit_id?: unknown } }).branch?.commit_id
        if (typeof id === 'string' && id) base = id
      } catch {
        /* the base stays unknown */
      }
    },

    after(upstream, text) {
      const head = target.publishedCommit ?? headFromAnswer(text)
      return buildDatasetVersions({
        applies,
        upstreamOk: upstream.ok,
        base,
        head,
      })
    },
  }
}
