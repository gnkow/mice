/**
 * Canonical audit resource URI: meta-style `type:id`, always non-empty.
 * One primary target per event (batch/multi-mount details stay in `detail`).
 */

export type AuditResourceUriSource = {
  action: string
  namespace?: string
  repo?: string
  detail?: Record<string, unknown>
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function firstJobId(detail: Record<string, unknown> | undefined): string | undefined {
  if (!detail) return undefined
  const one = str(detail.job_id)
  if (one) return one
  const many = detail.job_ids
  if (Array.isArray(many)) {
    for (const v of many) {
      const id = str(v)
      if (id) return id
    }
  }
  return undefined
}

function firstWorkspace(
  e: AuditResourceUriSource,
): { id: string; namespace?: string; repo?: string } | undefined {
  const detail = e.detail
  const direct = str(detail?.workspace_id)
  if (direct) {
    return { id: direct, namespace: e.namespace, repo: e.repo }
  }
  const mounts = detail?.mounts
  if (!Array.isArray(mounts)) return undefined
  for (const m of mounts) {
    if (!m || typeof m !== 'object') continue
    const row = m as Record<string, unknown>
    const id = str(row.workspace_id)
    if (!id) continue
    return {
      id,
      namespace: str(row.namespace) ?? e.namespace,
      repo: str(row.repo) ?? e.repo,
    }
  }
  return undefined
}

function workspaceUri(ws: { id: string; namespace?: string; repo?: string }): string {
  if (ws.namespace && ws.repo) return `workspace:${ws.namespace}/${ws.repo}!${ws.id}`
  return `workspace:${ws.id}`
}

function sessionId(detail: Record<string, unknown> | undefined): string | undefined {
  return str(detail?.session_id)
}

/**
 * Primary resource URI for an audit event.
 * Preference follows the action family, then concrete ids, then repo/namespace, then `action:…`.
 */
export function auditResourceUri(e: AuditResourceUriSource): string {
  const action = e.action.trim() || 'other'
  const family = action.split('.', 1)[0] ?? action
  const job = firstJobId(e.detail)
  const session = sessionId(e.detail)
  const workspace = firstWorkspace(e)

  if (family === 'job' && job) return `job:${job}`
  if (family === 'workspace' && workspace) return workspaceUri(workspace)
  if (family === 'session' && session) return `session:${session}`

  if (job) return `job:${job}`
  if (workspace) return workspaceUri(workspace)
  if (session) return `session:${session}`
  if (e.namespace && e.repo) return `repo:${e.namespace}/${e.repo}`
  if (e.namespace) return `namespace:${e.namespace}`
  return `action:${action}`
}
