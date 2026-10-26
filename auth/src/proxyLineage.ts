import { env } from './env.js'
import { actorFromUser, type AuditVia } from './audit.js'
import {
  buildExplicitFileOp,
  classifyFileLineageOp,
  fetchFileEntrySnapshot,
  parseCommitIdFromJson,
  type FileEntrySnapshot,
  type LineageKind,
} from './lineage.js'
import type { SessionUser } from './authentication/session/session.js'

export type LineageCapture = {
  /** Snapshot the prior file entry; call before forwarding the write upstream. */
  before(): Promise<void>
  /** The lineage kind of this request (needs `before` for upload vs edit). */
  kind(): LineageKind | undefined
  /** Record the lineage op after the upstream answered; `text` is the JSON answer, already buffered by the caller. */
  after(upstream: Response, text: string | undefined, auditEventId?: string): Promise<void>
}

export function createLineageCapture(opts: {
  method: string
  pathname: string
  moveNewPath?: string
  copyFrom?: string
  restoreFrom?: string
  user: SessionUser
  via: AuditVia
  fetchImpl?: typeof fetch
}): LineageCapture {
  const { method, pathname, moveNewPath, copyFrom, restoreFrom, user, via } = opts
  let priorSnapshot: FileEntrySnapshot | null = null

  const classify = () =>
    classifyFileLineageOp(method, pathname, {
      newPath: moveNewPath,
      priorExists: priorSnapshot != null,
      copyFrom,
      restoreFrom,
    })

  return {
    async before() {
      const tentative = classify()
      if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        tentative.namespace &&
        tentative.repo &&
        tentative.path &&
        (method === 'PUT' || method === 'POST' || method === 'DELETE' || method === 'PATCH')
      ) {
        const revision =
          tentative.kind === 'restore' && restoreFrom ? restoreFrom : tentative.branch
        if (revision) {
          priorSnapshot = await fetchFileEntrySnapshot(
            tentative.namespace,
            tentative.repo,
            revision,
            tentative.path,
            opts.fetchImpl,
          )
        }
      }
    },

    kind() {
      if (method === 'GET' || method === 'HEAD') return undefined
      return classify().kind ?? undefined
    },

    async after(upstream, text, auditEventId) {
      if (method === 'GET' || method === 'HEAD') return
      const fileOp = classify()
      if (!upstream.ok || !fileOp.kind) return

      let commitId: string | undefined
      if (text !== undefined) {
        try {
          commitId = parseCommitIdFromJson(JSON.parse(text) as unknown)
        } catch {
          /* ignore parse errors */
        }
      }

      if (fileOp.namespace && fileOp.repo) {
        let contentHash: string | undefined
        const moves =
          fileOp.kind === 'move' || fileOp.kind === 'rename' || fileOp.kind === 'copy'
        if (
          (moves || fileOp.kind === 'upload' || fileOp.kind === 'edit' || fileOp.kind === 'restore') &&
          fileOp.branch
        ) {
          const outPath = moves ? (fileOp.newPath ?? moveNewPath) : fileOp.path
          if (outPath) {
            const written = await fetchFileEntrySnapshot(
              fileOp.namespace,
              fileOp.repo,
              fileOp.branch,
              outPath,
              opts.fetchImpl,
            )
            contentHash = written?.contentHash
          }
        }

        await buildExplicitFileOp({
          kind: fileOp.kind,
          namespace: fileOp.namespace,
          repo: fileOp.repo,
          branch: fileOp.branch,
          path: fileOp.path,
          newPath: fileOp.newPath ?? moveNewPath,
          commitId,
          contentHash,
          priorContentHash: priorSnapshot?.contentHash,
          priorCommitId:
            priorSnapshot?.commitId ?? (fileOp.kind === 'restore' ? restoreFrom : undefined),
          actor: actorFromUser(user),
          via,
          auditEventId,
        })
      }
    },
  }
}

const VERSIONED_ACTIONS = new Set([
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
function datasetTarget(pathname: string): { namespace?: string; repo?: string; branch?: string; publishedCommit?: string } {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'repos' || parts.length < 4) return {}
  const [namespace, repo] = [decode(parts[2]), decode(parts[3])]
  const rest = parts.slice(4)
  if (rest[0] === 'file' || rest[0] === 'branches') return { namespace, repo, branch: decode(rest[1]) }
  if (rest[0] === 'merge' || rest[0] === 'merges') return { namespace, repo, branch: decode(rest[1]?.split('..')[0]) }
  if (rest[0] === 'workspaces' && (rest[2] === 'commit' || rest[2] === 'merge')) {
    return { namespace, repo, branch: decode(rest[3]) }
  }
  if (rest[0] === 'commits' && rest[2] === 'complete') return { namespace, repo, publishedCommit: decode(rest[1]) }
  return { namespace, repo }
}

function headFromAnswer(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  let body: { commit?: { id?: unknown }; branch?: { commit_id?: unknown }; commits?: { merge?: { id?: unknown } } }
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
 * The dataset version before and after a dataset mutation, so an auditor can reconstruct the data
 * state. The head is only what the upstream answer states (or the commit a publish names); it is
 * never guessed from the branch tip afterwards, as that could belong to someone else's change.
 */
export function createDatasetCapture(opts: {
  method: string
  pathname: string
  action: string
  fetchImpl?: typeof fetch
}): DatasetCapture {
  const applies = VERSIONED_ACTIONS.has(opts.action)
  const target = datasetTarget(opts.pathname)
  let base: string | undefined

  return {
    async before() {
      if (!applies || !target.namespace || !target.repo || !target.branch) return
      const url = `${env.oxenUpstream}/api/repos/${encodeURIComponent(target.namespace)}/${encodeURIComponent(target.repo)}/branches/${encodeURIComponent(target.branch)}`
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
      if (!applies || !upstream.ok) return {}
      const head = target.publishedCommit ?? headFromAnswer(text)
      const dataset = { ...(base ? { base } : {}), ...(head ? { head } : {}) }
      return {
        ...(Object.keys(dataset).length ? { dataset } : {}),
        ...(head ? {} : { unverified: true as const }),
      }
    },
  }
}
