import { actorFromUser } from '../../audit/index.js'
import type { AuditVia } from '../../audit/index.js'
import {
  createDatasetCapture,
  type DatasetCapture,
  type DatasetVersions,
} from '../../audit/index.js'
import { buildExplicitFileOp, classifyFileLineageOp, readFileEntrySnapshot, parseCommitIdFromJson, FileEntrySnapshot, LineageKind } from '../../namespaces/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { FileHashDelta } from './proxyChange.js'

export type { DatasetCapture, DatasetVersions }
export { createDatasetCapture }


export type LineageCapture = {
  /** Snapshot the prior file entry; call before forwarding the write upstream. */
  before(): Promise<void>
  /** True when the prior entry could not be read (oxen unreachable/erroring): the change cannot be audited. */
  beforeUnavailable(): boolean
  /** Per-file content-hash deltas for an answered request (empty when not a file op or unverifiable). */
  fileDeltas(upstream: Response): Promise<FileHashDelta[]>
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
  let priorUnavailable = false
  let written: Promise<string | undefined> | undefined

  const classify = () =>
    classifyFileLineageOp(method, pathname, {
      newPath: moveNewPath,
      priorExists: priorSnapshot != null,
      copyFrom,
      restoreFrom,
    })

  /** The hash of the file this request wrote (at its new path for moves/copies); read once. */
  const writtenHash = (): Promise<string | undefined> => {
    written ??= (async () => {
      const fileOp = classify()
      const moves = fileOp.kind === 'move' || fileOp.kind === 'rename' || fileOp.kind === 'copy'
      if (
        !fileOp.namespace ||
        !fileOp.repo ||
        !fileOp.branch ||
        !(moves || fileOp.kind === 'upload' || fileOp.kind === 'edit' || fileOp.kind === 'restore')
      ) {
        return undefined
      }
      const outPath = moves ? (fileOp.newPath ?? moveNewPath) : fileOp.path
      if (!outPath) return undefined
      const entry = await readFileEntrySnapshot(
        fileOp.namespace,
        fileOp.repo,
        fileOp.branch,
        outPath,
        opts.fetchImpl,
      )
      return entry.snapshot?.contentHash
    })()
    return written
  }

  return {
    beforeUnavailable: () => priorUnavailable,

    async fileDeltas(upstream) {
      if (method === 'GET' || method === 'HEAD' || !upstream.ok) return []
      const fileOp = classify()
      if (!fileOp.kind || !fileOp.path) return []
      const priorHash = priorSnapshot?.contentHash ?? null
      if (fileOp.kind === 'delete') return [{ path: fileOp.path, before: priorHash, after: null }]
      const hash = await writtenHash()
      if (hash === undefined) return []
      if (fileOp.kind === 'copy') {
        return fileOp.newPath ? [{ path: fileOp.newPath, before: null, after: hash }] : []
      }
      if (fileOp.kind === 'move' || fileOp.kind === 'rename') {
        return [
          { path: fileOp.path, before: priorHash, after: null },
          ...(fileOp.newPath ? [{ path: fileOp.newPath, before: null, after: hash }] : []),
        ]
      }
      return [{ path: fileOp.path, before: priorHash, after: hash }]
    },

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
          const read = await readFileEntrySnapshot(
            tentative.namespace,
            tentative.repo,
            revision,
            tentative.path,
            opts.fetchImpl,
          )
          priorSnapshot = read.snapshot
          priorUnavailable = read.unavailable
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
        const contentHash = await writtenHash()

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

