import { actorFromUser, appendAudit, type AuditVia } from './audit.js'
import { setRepoCollaborator } from './authzCollaboratorStore.js'
import { hasInstancePermission, isAuthzEnforce, isInstanceAdmin } from './authzInstanceStore.js'
import { ensureNamespaceForCreate } from './authzNamespaceStore.js'
import { visibleNamespaceNames } from './authzVisibility.js'
import type { SessionUser } from './session.js'

/**
 * Under enforce, narrow `GET /api/namespaces` to the caller's visible namespaces.
 * Returns the rewritten body, or null when the response is left untouched.
 * The upstream body is consumed whenever a JSON catalog is read.
 */
export async function filterNamespaceCatalog(
  user: SessionUser,
  method: string,
  pathname: string,
  upstream: Response,
): Promise<string | null> {
  if (
    !isAuthzEnforce() ||
    method !== 'GET' ||
    (pathname.replace(/\/+$/, '') || '/') !== '/api/namespaces' ||
    !upstream.ok
  ) {
    return null
  }
  if (!(upstream.headers.get('content-type') ?? '').includes('application/json')) return null
  let text: string
  try {
    text = await upstream.text()
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(text) as {
      namespaces?: Array<{ namespace?: string; name?: string }>
      [key: string]: unknown
    }
    const visible = visibleNamespaceNames(user)
    if (visible !== 'all' && Array.isArray(parsed.namespaces)) {
      const allow = new Set(visible)
      parsed.namespaces = parsed.namespaces.filter((n) => allow.has(n.namespace ?? n.name ?? ''))
    }
    return JSON.stringify(parsed)
  } catch {
    return text
  }
}

/** After a successful repo create: seed the AuthZ namespace (privileged callers) and make the creator repo Admin. */
export function seedRepoCreate(user: SessionUser, namespace: string, repo: string): void {
  if (isInstanceAdmin(user) || hasInstancePermission(user, 'create_namespace')) {
    ensureNamespaceForCreate(user, namespace, 'none')
  }
  void setRepoCollaborator(namespace, repo, user, 'admin')
}

/** Audit that a site admin was allowed through on the bypass, not on a grant. */
export function recordSiteAdminBypass(input: {
  user: SessionUser
  via: AuditVia
  method: string
  pathname: string
  namespace?: string
  repo?: string
  reason?: string
}): void {
  appendAudit({
    actor: actorFromUser(input.user),
    via: input.via,
    method: input.method,
    path: input.pathname,
    status: 0,
    action: 'site_admin_bypass',
    namespace: input.namespace,
    repo: input.repo,
    detail: { reason: input.reason },
  })
}
