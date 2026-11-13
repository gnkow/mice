import { actorFromUser, appendAudit, type AuditVia } from './audit.js'
import { setRepoCollaborator } from './authzCollaboratorStore.js'
import { decideInstanceAction } from './authz.js'
import { ensureNamespaceForCreate, getNamespace } from './authzNamespaceStore.js'
import { ensureRepository } from './repositoryStore.js'
import { visibleNamespaceNames } from './authzVisibility.js'
import { type SessionUser } from './authentication/index.js'

/**
 * Narrow `GET /api/namespaces` to the caller's visible namespaces.
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
    const visible = await visibleNamespaceNames(user)
    if (visible !== 'all' && Array.isArray(parsed.namespaces)) {
      const allow = new Set(visible)
      parsed.namespaces = parsed.namespaces.filter((n) => allow.has(n.namespace ?? n.name ?? ''))
    }
    return JSON.stringify(parsed)
  } catch {
    return text
  }
}

export type SeededRepository = { repositoryId: string }

/**
 * After a successful repo create: seed the AuthZ namespace (privileged callers) and make the creator
 * repo Admin. Returns the stable AuthZ repository id when a row was ensured.
 */
export async function seedRepoCreate(
  user: SessionUser,
  namespace: string,
  repo: string,
): Promise<SeededRepository | null> {
  if ((await decideInstanceAction(user, 'namespace.create')).allow) {
    await ensureNamespaceForCreate(user, namespace, 'none')
  }
  // A collaborator grant hangs off a namespace row; an unseeded namespace has nothing to attach to.
  if (!(await getNamespace(namespace))) return null
  const record = await ensureRepository(namespace, repo)
  if (!record) return null
  await setRepoCollaborator(namespace, repo, user, 'admin')
  return { repositoryId: record.id }
}

/** Stamp the AuthZ stable id onto a proxied oxen create JSON body. */
export function attachRepositoryId(body: string, repositoryId: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    parsed.repository_id = repositoryId
    const repository = parsed.repository
    if (repository && typeof repository === 'object' && !Array.isArray(repository)) {
      ;(repository as Record<string, unknown>).repository_id = repositoryId
    }
    return JSON.stringify(parsed)
  } catch {
    return body
  }
}

/** Audit that a site admin was allowed through on the bypass, not on a grant. */
export async function recordAclBypassRead(input: {
  user: SessionUser
  via: AuditVia
  method: string
  pathname: string
  namespace?: string
  repo?: string
  reason?: string
}): Promise<void> {
  await appendAudit({
    actor: actorFromUser(input.user),
    via: input.via,
    method: input.method,
    path: input.pathname,
    status: 0,
    action: 'acl_bypass_read',
    namespace: input.namespace,
    repo: input.repo,
    detail: { reason: input.reason },
  })
}
