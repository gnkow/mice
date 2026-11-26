import { actorFromUser } from '../../audit/index.js'
import { appendAudit } from '../../audit/index.js'
import type { AuditVia } from '../../audit/index.js'
import { EMPTY_AUDIT_CHANGE } from '../../audit/change.js'
import { datasetTarget } from '../../audit/index.js'
import { decideInstanceAction } from '../../authz/index.js'
import { ensureNamespaceForCreate } from '../../authz/index.js'
import { getNamespace } from '../../authz/index.js'
import { createOwnedRepository, ensureRepository } from '../../authz/index.js'
import { userKey } from '../../authz/index.js'
import { visibleNamespaceNames } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import { ensureEmptyOxenBranch } from '../../namespaces/index.js'
import { isPhysicalOxenKey } from '../../namespaces/index.js'
import { displayNamespaceName, resolvePhysicalRepo } from '../../namespaces/index.js'
import { readRepositoryById } from '../../authz/index.js'
import { env } from '../../shared/index.js'
import { branchTargetFromPath, isTipChangingAction } from '../../merge/index.js'
import { getUpstreamFetch } from './proxyUpstream.js'

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

/** Live tip via the same upstream transport the proxy uses (testable with setUpstreamFetch). */
export async function resolveProxiedBranchTip(
  namespace: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  const physical = await resolvePhysicalRepo(namespace, repo)
  if (!physical) return undefined
  const res = await getUpstreamFetch()(
    `${env.oxenUpstream}/api/repos/${encodeURIComponent(physical.namespaceId)}/${encodeURIComponent(physical.repositoryId)}/branches/${encodeURIComponent(branch)}`,
  )
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    return undefined
  }
  const body = (await res.json()) as {
    branch?: { commit_id?: string; commit?: { id?: string } }
    commit_id?: string
  }
  return body.branch?.commit_id ?? body.branch?.commit?.id ?? body.commit_id
}

/**
 * After a successful tip-changing proxy write, mark open MRs stale (#158).
 * `commit.publish` has no branch in the path — resolve via live tips of open MRs.
 */
export async function markStaleAfterProxiedTipWrite(input: {
  namespace: string
  repo: string
  action: string
  pathname: string
  detailBranch?: string
}): Promise<void> {
  if (!isTipChangingAction(input.action)) return
  const { readRepository } = await import('../../authz/stores.js')
  const {
    markOpenMergeRequestsStaleForTip,
    markOpenMergeRequestsStaleForPublishedCommit,
  } = await import('../../merge/index.js')
  const repoRow = await readRepository(input.namespace, input.repo)
  if (!repoRow) return

  const branch =
    input.detailBranch?.trim() || branchTargetFromPath(input.pathname) || undefined
  if (branch) {
    const tip = await resolveProxiedBranchTip(input.namespace, input.repo, branch)
    if (!tip) return
    await markOpenMergeRequestsStaleForTip({
      repositoryId: repoRow.id,
      branch,
      newTip: tip,
    })
    return
  }

  if (input.action !== 'commit.publish') return
  const published = datasetTarget(input.pathname).publishedCommit?.trim()
  if (!published) return
  await markOpenMergeRequestsStaleForPublishedCommit({
    repositoryId: repoRow.id,
    publishedCommit: published,
    resolveLiveTip: (b) => resolveProxiedBranchTip(input.namespace, input.repo, b),
  })
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
