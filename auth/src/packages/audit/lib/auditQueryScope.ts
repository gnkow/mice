import { authorizeAuditQuery } from '../../authz/index.js'
import { getUserRole } from '../../authz/rbac.js'
import { parseAuditFocus } from './auditQueryFilters.js'
import { auditorExcludeActions, getAuditVisibility } from './auditVisibility.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { AuditQuery, AuditVia } from './auditTypes.js'

export type AuditQueryParams = {
  namespace?: string
  repo?: string
  actor?: string
  action?: string
  focus?: string
  since?: string
  until?: string
  sessionId?: string
  workspaceId?: string
  jobId?: string
  via?: string
  includeChain?: boolean
  orphansOnly?: boolean
}

/**
 * AuthZ + auditor visibility + filter params → list/export {@link AuditQuery}.
 * Returns a denial reason when the caller may not read the requested scope.
 */
export async function resolveAuditQueryScope(
  session: SessionUser,
  params: AuditQueryParams,
): Promise<{ error: string; status: 403 } | { query: AuditQuery }> {
  let namespace = params.namespace || undefined
  const gate = await authorizeAuditQuery(session, namespace)
  if (!gate.allow) {
    return { error: gate.reason ?? 'Forbidden', status: 403 }
  }
  if (gate.forceNamespace) namespace = gate.forceNamespace
  const via = params.via
  const role = await getUserRole(session)
  const excludeActions =
    role === 'auditor'
      ? auditorExcludeActions((await getAuditVisibility()).hiddenActions)
      : undefined
  return {
    query: {
      actor: params.actor || undefined,
      namespace,
      repo: params.repo || undefined,
      action: params.action || undefined,
      focus: parseAuditFocus(params.focus),
      since: params.since || undefined,
      until: params.until || undefined,
      sessionId: params.sessionId || undefined,
      workspaceId: params.workspaceId || undefined,
      jobId: params.jobId || undefined,
      via: via === 'session' || via === 'pat' ? (via as AuditVia) : undefined,
      allowedNamespaces: gate.ownedOnly,
      includeChain: params.includeChain,
      orphansOnly: params.orphansOnly,
      ...(excludeActions && excludeActions.length > 0 ? { excludeActions } : {}),
    },
  }
}
