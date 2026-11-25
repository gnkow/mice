import { actorFromUser, appendAudit, type AuditVia } from './audit.js'
import { EMPTY_AUDIT_CHANGE } from './auditChange.js'
import { decideInstanceAction } from './authz.js'
import { ensureNamespaceForCreate, getNamespace } from './authzNamespaceStore.js'
import { createOwnedRepository, ensureRepository } from './repositoryStore.js'
import { userKey } from './authzTypes.js'
import { visibleNamespaceNames } from './authzVisibility.js'
import { type SessionUser } from './authentication/index.js'
import { ensureEmptyOxenBranch } from './oxenEmptyBranch.js'
import { isPhysicalOxenKey } from './oxenPhysicalKeys.js'
import { displayNamespaceName, resolvePhysicalRepo } from './oxenPhysicalResolve.js'
import { readRepositoryById } from './repositoryStore.js'

/**
 * Narrow `GET /api/namespaces` to the caller's visible namespaces.
 * Rewrites physical UUID keys to display names before visibility filtering.
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
    if (Array.isArray(parsed.namespaces)) {
      for (const n of parsed.namespaces) {
        for (const key of ['namespace', 'name'] as const) {
          const raw = n[key]
          if (typeof raw !== 'string' || !isPhysicalOxenKey(raw)) continue
          const display = await displayNamespaceName(raw)
          if (display) n[key] = display
        }
      }
      const visible = await visibleNamespaceNames(user)
      if (visible !== 'all') {
        const allow = new Set(visible)
        parsed.namespaces = parsed.namespaces.filter((n) =>
          allow.has(n.namespace ?? n.name ?? ''),
        )
      }
    }
    return JSON.stringify(parsed)
  } catch {
    return text
  }
}

export type SeededRepository = { repositoryId: string }

/**
 * After a successful repo create: seed the AuthZ namespace (privileged callers) and mint the
 * repository row. Does not grant a collaborator seat. Returns the stable AuthZ repository id.
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
  const record = await createOwnedRepository(namespace, repo, userKey(user))
  if (!record) return null
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

export type FinalizeRepoCreateOptions = {
  /** Empty-tip commit message (BFF rewrite; default "Initialized Repo"). */
  initialCommitMessage?: string
}

/**
 * After a successful proxied repo create: seed AuthZ and stamp `repository_id`
 * onto the upstream JSON body. Returns the body unchanged when seeding cannot run.
 */
export async function finalizeProxiedRepoCreate(
  user: SessionUser,
  namespace: string,
  repo: string,
  responseBody: string,
  options?: FinalizeRepoCreateOptions,
): Promise<string> {
  const seeded = await seedRepoCreate(user, namespace, repo)
  if (!seeded) return responseBody
  // Default branch starts empty (GxP): materialize oxen tip with no files.
  const physical = await resolvePhysicalRepo(namespace, repo)
  if (physical) {
    await ensureEmptyOxenBranch(physical.namespaceId, physical.repositoryId, 'main', user, {
      message: options?.initialCommitMessage,
    })
  }
  return attachRepositoryId(responseBody, seeded.repositoryId)
}

/**
 * Before oxen POST /branches: if `from_name` is missing on an empty (or
 * otherwise tip-less) repo, create that source as an empty tip so the fork
 * succeeds without seeding files.
 */
export async function ensureBranchCreateSourceTip(
  namespace: string,
  repo: string,
  fromName: string | undefined,
  actor: SessionUser,
): Promise<void> {
  const source = fromName?.trim()
  if (!source) return
  const physical = await resolvePhysicalRepo(namespace, repo)
  if (!physical) return
  await ensureEmptyOxenBranch(physical.namespaceId, physical.repositoryId, source, actor)
}

const REPO_DETAIL_PATH = /^\/api\/repos\/([^/]+)\/([^/]+)$/

/**
 * Stamp AuthZ `repository_id` onto a successful GET repo detail response.
 * Returns the rewritten body, or null when the response is left untouched.
 * Consumes the upstream body whenever a JSON detail payload is read.
 */
export async function stampRepositoryIdOnRepoDetail(
  method: string,
  pathname: string,
  upstream: Response,
): Promise<string | null> {
  if (method !== 'GET' || !upstream.ok) return null
  const match = (pathname.replace(/\/+$/, '') || '/').match(REPO_DETAIL_PATH)
  if (!match) return null
  if (!(upstream.headers.get('content-type') ?? '').includes('application/json')) return null
  const ns = decodeURIComponent(match[1]!)
  const repo = decodeURIComponent(match[2]!)
  // Prefer id lookup / display resolve — never mint a row whose name is a physical UUID.
  let repositoryId: string | null = null
  if (isPhysicalOxenKey(repo)) {
    const byId = await readRepositoryById(repo)
    repositoryId = byId?.id ?? null
  } else {
    const physical = await resolvePhysicalRepo(ns, repo)
    repositoryId = physical?.repositoryId ?? null
    if (!repositoryId) {
      const minted = await ensureRepository(ns, repo)
      repositoryId = minted?.id ?? null
    }
  }
  if (!repositoryId) return null
  let text: string
  try {
    text = await upstream.text()
  } catch {
    return null
  }
  return attachRepositoryId(text, repositoryId)
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
    change: EMPTY_AUDIT_CHANGE,
    namespace: input.namespace,
    repo: input.repo,
    detail: { reason: input.reason },
  })
}
