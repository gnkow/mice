import { readRepository, readRepositoryById } from '../../authz/index.js'
import { createOwnedRepository, ensureRepository } from '../../authz/index.js'
import { namespaceIdByName, namespaceNameById } from '../../authz/index.js'
import { ensureNamespaceForCreate } from '../../authz/index.js'
import { getNamespace } from '../../authz/index.js'
import { decideInstanceAction } from '../../authz/index.js'
import { userKey } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { DisplayRepoRef, PhysicalRepoRef } from './oxenPhysicalKeys.js'
import {
  initialCommitMessageFromBody,
  isPhysicalOxenKey,
  physicalCreateBody,
  rewriteNamespacePathToPhysical,
  rewriteOxenJsonToDisplay,
  rewriteRepoListPathToPhysical,
  rewriteReposApiPathToPhysical,
} from './oxenPhysicalKeys.js'

export async function resolveNamespaceId(displayOrId: string): Promise<string | null> {
  if (isPhysicalOxenKey(displayOrId)) {
    const name = await namespaceNameById(displayOrId)
    return name ? displayOrId : null
  }
  return namespaceIdByName(displayOrId)
}

/**
 * Map client path segments to oxen physical keys.
 * Never mint AuthZ rows whose *names* are UUIDs — that traps list leakage into a dead end.
 */
export async function resolvePhysicalRepo(
  displayNs: string,
  displayRepo: string,
): Promise<PhysicalRepoRef | null> {
  if (isPhysicalOxenKey(displayRepo)) {
    const byId = await readRepositoryById(displayRepo)
    if (byId) {
      if (
        displayNs === byId.namespace ||
        displayNs === byId.namespaceId ||
        (isPhysicalOxenKey(displayNs) && displayNs === byId.namespaceId)
      ) {
        return { namespaceId: byId.namespaceId, repositoryId: byId.id }
      }
      return null
    }
    // Both segments already physical and unknown to AuthZ: pass through to oxen.
    if (isPhysicalOxenKey(displayNs)) {
      return { namespaceId: displayNs, repositoryId: displayRepo }
    }
    return null
  }

  const record = await readRepository(displayNs, displayRepo)
  if (record) return { namespaceId: record.namespaceId, repositoryId: record.id }
  // Mint on first touch for real display names only (legacy oxen → AuthZ bridge).
  if (isPhysicalOxenKey(displayNs)) return null
  const ensured = await ensureRepository(displayNs, displayRepo)
  if (!ensured) return null
  return { namespaceId: ensured.namespaceId, repositoryId: ensured.id }
}

export async function displayNamespaceName(namespaceId: string): Promise<string | null> {
  return namespaceNameById(namespaceId)
}

export async function displayRepoRef(
  namespaceId: string,
  repositoryId: string,
): Promise<DisplayRepoRef | null> {
  const record = await readRepositoryById(repositoryId)
  if (!record || record.namespaceId !== namespaceId) return null
  // Corrupt rows (name = physical id) must not be served as display names.
  if (isPhysicalOxenKey(record.name)) return null
  return { namespace: record.namespace, repo: record.name }
}

/**
 * Mint AuthZ namespace + owned repository for a display create, returning physical keys
 * to send to oxen. Display names stay on the AuthZ row.
 */
export async function preparePhysicalRepoCreate(
  user: SessionUser,
  displayNamespace: string,
  displayRepo: string,
): Promise<PhysicalRepoRef | null> {
  if (isPhysicalOxenKey(displayNamespace) || isPhysicalOxenKey(displayRepo)) return null
  if ((await decideInstanceAction(user, 'namespace.create')).allow) {
    await ensureNamespaceForCreate(user, displayNamespace, 'none')
  }
  if (!(await getNamespace(displayNamespace))) return null
  const record = await createOwnedRepository(displayNamespace, displayRepo, userKey(user))
  if (!record) return null
  return { namespaceId: record.namespaceId, repositoryId: record.id }
}

/** Display-side request facts the BFF already classified; mapping owns resolve+rewrite. */
export type DisplayRequestContext = {
  pathname: string
  body: string | undefined
  signatureBody: unknown
  user: SessionUser
  ns: string | null | undefined
  repo: string | null | undefined
  kind: string
  action: string
}

export type PhysicalUpstreamMapping = {
  path: string
  body: string | undefined
  createdPhysical: PhysicalRepoRef | null
  physicalRepo: PhysicalRepoRef | null | undefined
  initialCommitMessage: string | undefined
}

export type MapDisplayRequestResult =
  | ({ ok: true } & PhysicalUpstreamMapping)
  | { ok: false; reason: 'create_blocked' }

/**
 * Resolve display names to physical oxen keys and rewrite the upstream path/body.
 * Proxy stays a thin adapter over this seam.
 */
export async function mapDisplayRequestToPhysical(
  ctx: DisplayRequestContext,
): Promise<MapDisplayRequestResult> {
  const { pathname, body, signatureBody, user, ns, repo, kind, action } = ctx
  let path = pathname
  let upstreamBody = body
  let createdPhysical: PhysicalRepoRef | null = null
  let physicalRepo: PhysicalRepoRef | null | undefined
  let initialCommitMessage: string | undefined

  if ((action === 'repo.create' || kind === 'repo.create') && ns && repo) {
    createdPhysical = await preparePhysicalRepoCreate(user, ns, repo)
    if (!createdPhysical) return { ok: false, reason: 'create_blocked' }
    initialCommitMessage =
      initialCommitMessageFromBody(signatureBody) ??
      (typeof body === 'string'
        ? (() => {
            try {
              return initialCommitMessageFromBody(JSON.parse(body))
            } catch {
              return undefined
            }
          })()
        : undefined)
    upstreamBody = physicalCreateBody(typeof body === 'string' ? body : undefined, createdPhysical)
  } else if (ns && repo) {
    const physical = await resolvePhysicalRepo(ns, repo)
    physicalRepo = physical
    path = rewriteReposApiPathToPhysical(pathname, physical)
  } else if ((kind === 'repo.list' || action === 'repo.list') && ns) {
    const namespaceId = await resolveNamespaceId(ns)
    path = rewriteRepoListPathToPhysical(pathname, namespaceId)
  } else if ((kind === 'namespace.detail' || pathname.startsWith('/api/namespaces/')) && ns) {
    const namespaceId = await resolveNamespaceId(ns)
    path = rewriteNamespacePathToPhysical(pathname, namespaceId)
  }

  return {
    ok: true,
    path,
    body: upstreamBody,
    createdPhysical,
    physicalRepo,
    initialCommitMessage,
  }
}

export type DisplayResponseHints = {
  createdPhysical?: PhysicalRepoRef | null
  displayNs?: string | null
  displayRepo?: string | null
}

/**
 * Swap physical UUID keys in oxen JSON back to display names, resolving AuthZ as needed.
 */
export async function mapPhysicalResponseToDisplay(
  body: string,
  hints: DisplayResponseHints = {},
): Promise<string> {
  const displayNameCache = new Map<string, string>()
  const displayRepoCache = new Map<string, DisplayRepoRef>()
  const { createdPhysical, displayNs, displayRepo } = hints

  if (createdPhysical && displayNs && displayRepo) {
    displayNameCache.set(
      createdPhysical.namespaceId,
      (await displayNamespaceName(createdPhysical.namespaceId)) ?? displayNs,
    )
    displayRepoCache.set(`${createdPhysical.namespaceId}\0${createdPhysical.repositoryId}`, {
      namespace: displayNs,
      repo: displayRepo,
    })
  } else if (displayNs && displayRepo) {
    const physical = await resolvePhysicalRepo(displayNs, displayRepo)
    if (physical) {
      displayNameCache.set(physical.namespaceId, displayNs)
      displayRepoCache.set(`${physical.namespaceId}\0${physical.repositoryId}`, {
        namespace: displayNs,
        repo: displayRepo,
      })
    }
  } else if (displayNs) {
    const namespaceId = await resolveNamespaceId(displayNs)
    if (namespaceId) displayNameCache.set(namespaceId, displayNs)
  }

  const pairRe =
    /"namespace"\s*:\s*"([0-9a-f-]{36})"\s*,\s*"name"\s*:\s*"([0-9a-f-]{36})"/gi
  let pair: RegExpExecArray | null
  while ((pair = pairRe.exec(body))) {
    const namespaceId = pair[1]!
    const repositoryId = pair[2]!
    const key = `${namespaceId}\0${repositoryId}`
    if (displayRepoCache.has(key)) continue
    const ref = await displayRepoRef(namespaceId, repositoryId)
    if (ref) {
      displayRepoCache.set(key, ref)
      displayNameCache.set(namespaceId, ref.namespace)
    }
  }

  const nsOnlyRe = /"namespace"\s*:\s*"([0-9a-f-]{36})"/gi
  let nsOnly: RegExpExecArray | null
  while ((nsOnly = nsOnlyRe.exec(body))) {
    const id = nsOnly[1]!
    if (displayNameCache.has(id)) continue
    const name = await displayNamespaceName(id)
    if (name) displayNameCache.set(id, name)
  }

  return rewriteOxenJsonToDisplay(
    body,
    (id) => displayNameCache.get(id) ?? null,
    (namespaceId, repositoryId) =>
      displayRepoCache.get(`${namespaceId}\0${repositoryId}`) ?? null,
  )
}
