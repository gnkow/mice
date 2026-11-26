import { auditChange, AuditChange } from '../../audit/change.js'
import { EMPTY_AUDIT_CHANGE, requireAuditChange } from '../../audit/change.js'
import { VERSIONED_ACTIONS } from '../../audit/index.js'

/** A file whose content hash a proxied request changed (`null` = absent on that side). */
export type FileHashDelta = { path: string; before: string | null; after: string | null }

/** Marker for a side of a change the proxy could not read (path known, hash unknown). */
export const UNVERIFIED = 'unverified'

export type ProxyChangeInput = {
  action: string
  /** The upstream answered 2xx; any other answer means nothing changed. */
  upstreamOk: boolean
  namespace?: string
  repo?: string
  /** Branch the request targets (from the path). */
  branch?: string
  /** Branch head before the mutation (undefined: the branch did not exist). */
  base?: string
  /** Branch head the answer states (undefined: unknown → recorded as unverified). */
  head?: string
  fileDeltas?: readonly FileHashDelta[]
  /**
   * Paths a staging request targeted (`workspace.file.*`), used when no hash deltas could be read.
   * Hashes are then recorded as {@link UNVERIFIED}.
   */
  paths?: readonly string[]
  /** Physical repository id: minted for `repo.create`, resolved before `repo.delete`. */
  repositoryId?: string
  workspaceId?: string
  /** Repository settings before / after a `repo.metadata` request (both needed to record the change). */
  metadataBefore?: Record<string, unknown> | null
  metadataAfter?: Record<string, unknown> | null
}

/** Workspace id stated by an oxen JSON answer. */
export function workspaceIdFromAnswer(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  try {
    const body = JSON.parse(text) as {
      workspace_id?: unknown
      workspace?: { id?: unknown; workspace_id?: unknown }
    }
    for (const id of [body.workspace_id, body.workspace?.workspace_id, body.workspace?.id]) {
      if (typeof id === 'string' && id.trim()) return id.trim()
    }
  } catch {
    /* not JSON */
  }
  return undefined
}

/**
 * Paths a workspace staging request targets: the segments after `/workspaces/<id>/files|changes/`.
 * Empty when the path names no file.
 */
export function workspaceFilePathsFromPathname(pathname: string): string[] {
  const m = /\/workspaces\/[^/]+\/(?:files|changes)\/(.+)$/.exec(pathname)
  if (!m) return []
  try {
    const path = decodeURIComponent(m[1]!).replace(/\/+$/, '')
    return path ? [path] : []
  } catch {
    return []
  }
}

const repoState = (i: ProxyChangeInput): Record<string, unknown> => ({
  namespace: i.namespace ?? null,
  repo: i.repo ?? null,
  repository_id: i.repositoryId ?? null,
})

/**
 * Change of a workspace staging write/delete. Hash deltas win; with only paths each path is
 * recorded absent→unverified (write) or unverified→absent (delete); with neither, the staged
 * area itself is recorded as touched. Never empty for an answered request.
 */
function workspaceFileChange(input: ProxyChangeInput): AuditChange {
  const del = input.action === 'workspace.file.delete'
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  if (input.fileDeltas && input.fileDeltas.length > 0) {
    for (const file of input.fileDeltas) {
      before[`file.${file.path}`] = file.before
      after[`file.${file.path}`] = file.after
    }
    return requireAuditChange(before, after)
  }
  const paths = input.paths ?? []
  for (const path of paths) {
    before[`file.${path}`] = del ? UNVERIFIED : null
    after[`file.${path}`] = del ? null : UNVERIFIED
  }
  if (paths.length === 0) {
    const key = input.workspaceId ? `workspace.${input.workspaceId}.staged` : 'workspace.staged'
    before[key] = del ? UNVERIFIED : null
    after[key] = del ? null : UNVERIFIED
  }
  return requireAuditChange(before, after)
}

/**
 * The audit change of a proxied oxen mutation, built from state observed around the upstream call.
 *
 * - Dataset versions (file write/delete, publish, merge, branch, workspace commit/merge): the branch
 *   head commit base→head, plus the content hash of every file the request touched.
 * - Create/delete of repos, namespaces and workspaces: null→record / record→null.
 * - Workspace staging (`workspace.file.write` / `workspace.file.delete`): the file hash deltas, else
 *   the targeted paths, else the staged area (never empty once the upstream answered).
 * - `repo.metadata`: AuthZ settings before→after (`metadataBefore` / `metadataAfter`).
 * - Anything the upstream refused, and transport requests that move no version (chunk upload):
 *   {@link EMPTY_AUDIT_CHANGE}.
 *
 * Throws {@link NoChangeError} for an answered mutation that left the state as it was.
 */
export function proxyMutationChange(input: ProxyChangeInput): AuditChange {
  if (!input.upstreamOk) return EMPTY_AUDIT_CHANGE
  const { action } = input

  if (VERSIONED_ACTIONS.has(action) || action === 'branch.delete') {
    const headKey = input.branch ? `head.${input.branch}` : 'head'
    const before: Record<string, unknown> = { [headKey]: input.base ?? null }
    const after: Record<string, unknown> = {
      [headKey]: action === 'branch.delete' ? null : (input.head ?? null),
    }
    for (const file of input.fileDeltas ?? []) {
      before[`file.${file.path}`] = file.before
      after[`file.${file.path}`] = file.after
    }
    if (action !== 'branch.delete' && input.head === undefined) {
      // New head unknown: still a mutation, recorded as unverified rather than refused.
      after.head_verified = false
      return auditChange(before, after)
    }
    return requireAuditChange(before, after)
  }

  switch (action) {
    case 'repo.create':
      return requireAuditChange(null, repoState(input))
    case 'repo.delete':
      return requireAuditChange(repoState(input), null)
    case 'namespace.create':
      return requireAuditChange(null, { namespace: input.namespace ?? null })
    case 'workspace.create':
      return requireAuditChange(null, {
        workspace_id: input.workspaceId ?? null,
        namespace: input.namespace ?? null,
        repo: input.repo ?? null,
      })
    case 'workspace.delete':
      return requireAuditChange(
        { workspace_id: input.workspaceId ?? null, namespace: input.namespace ?? null, repo: input.repo ?? null },
        null,
      )
    case 'workspace.file.write':
    case 'workspace.file.delete':
      return workspaceFileChange(input)
    case 'repo.metadata':
      return requireAuditChange(
        input.metadataBefore ?? { description: null },
        input.metadataAfter ?? { description: null },
      )
    default:
      return EMPTY_AUDIT_CHANGE
  }
}
