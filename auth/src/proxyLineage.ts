import { actorFromUser, type AuditVia } from './audit.js'
import {
  buildExplicitFileOp,
  classifyFileLineageOp,
  fetchFileEntrySnapshot,
  parseCommitIdFromJson,
  type FileEntrySnapshot,
  type LineageKind,
} from './lineage.js'
import type { SessionUser } from './session.js'

export type LineageCapture = {
  /** Snapshot the prior file entry; call before forwarding the write upstream. */
  before(): Promise<void>
  /** The lineage kind of this request (needs `before` for upload vs edit). */
  kind(): LineageKind | undefined
  /**
   * Record the lineage op after the upstream answered. Returns the buffered
   * response text when the body was consumed (so the caller must serve it).
   */
  after(upstream: Response, auditEventId?: string): Promise<string | undefined>
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

    async after(upstream, auditEventId) {
      if (method === 'GET' || method === 'HEAD') return undefined
      const fileOp = classify()
      if (!upstream.ok || !fileOp.kind) return undefined

      let buffered: string | undefined
      let commitId: string | undefined
      if ((upstream.headers.get('content-type') ?? '').includes('application/json')) {
        try {
          buffered = await upstream.text()
          try {
            commitId = parseCommitIdFromJson(JSON.parse(buffered) as unknown)
          } catch {
            /* ignore parse errors */
          }
        } catch {
          buffered = undefined
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

        buildExplicitFileOp({
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
      return buffered
    },
  }
}
