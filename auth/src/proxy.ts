import type { Context } from 'hono'
import { env } from './env.js'
import { interpretRequest, type SessionUser } from './authentication/index.js'
import {
  actorFromUser,
  appendAudit,
  appendIntent,
  appendOutcome,
  auditChainBlocked,
  type AuditEvent,
  type AuditVia,
} from './audit.js'
import { isDatasetMutation, REASON_HEADER, resolveReason, type ReasonRejection, type ResolvedReason } from './auditReason.js'
import { createDatasetCapture, createLineageCapture, type DatasetVersions } from './proxyLineage.js'
import { authorizeApiRequest } from './authz.js'
import { interpretRequestBody } from './proxyBody.js'
import { nonCanonicalPathReason } from './pathCanonical.js'
import { filterNamespaceCatalog, recordSiteAdminBypass, seedRepoCreate } from './proxyEffects.js'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'cookie',
  'authorization',
  REASON_HEADER,
])

function filterRequestHeaders(headers: Headers): Headers {
  const out = new Headers()
  headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return
    out.set(key, value)
  })
  return out
}

async function rejectUnclassifiedWrite(
  user: SessionUser,
  via: AuditVia,
  method: string,
  pathname: string,
  reason: string,
  scope: { namespace?: string; repo?: string } = {},
): Promise<Response> {
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method,
    path: pathname,
    status: 400,
    action: 'request.rejected',
    ...(scope.namespace ? { namespace: scope.namespace } : {}),
    ...(scope.repo ? { repo: scope.repo } : {}),
    detail: { reason },
  })
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: 'bad_request',
      error: { detail: 'Request body could not be classified' },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

async function rejectReason(
  user: SessionUser,
  via: AuditVia,
  method: string,
  pathname: string,
  rejection: ReasonRejection,
  scope: { namespace?: string; repo?: string },
): Promise<Response> {
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method,
    path: pathname,
    status: 400,
    action: 'request.rejected',
    ...(scope.namespace ? { namespace: scope.namespace } : {}),
    ...(scope.repo ? { repo: scope.repo } : {}),
    detail: { reason: rejection.code },
  })
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: rejection.code,
      error: { detail: rejection.detail },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

function auditChainBroken(): Response {
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: 'audit_chain_broken',
      error: { detail: 'Audit chain verification failed; dataset changes are blocked until an instance admin acknowledges it' },
    }),
    { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '300' } },
  )
}

function auditUnavailable(): Response {
  return new Response(
    JSON.stringify({
      status: 'error',
      status_message: 'audit_unavailable',
      error: { detail: 'Audit store unavailable; the change was refused and nothing was applied' },
    }),
    { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '30' } },
  )
}

let upstreamFetch: typeof fetch = (input, init) => fetch(input, init)

/** Swap the upstream transport (tests); returns a function restoring the previous one. */
export function setUpstreamFetch(next: typeof fetch): () => void {
  const prev = upstreamFetch
  upstreamFetch = next
  return () => {
    upstreamFetch = prev
  }
}

export type ProxyAuth = {
  user: SessionUser
  via: AuditVia
}

export async function proxyToOxen(
  c: Context,
  auth: ProxyAuth,
): Promise<Response> {
  const { user, via } = auth
  const url = new URL(c.req.url)
  const pathname = url.pathname
  const method = c.req.method
  const nonCanonical = nonCanonicalPathReason(pathname)
  if (nonCanonical) {
    return new Response(
      JSON.stringify({
        status: 'error',
        status_message: 'bad_request',
        error: { detail: `Non-canonical request path (${nonCanonical})` },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
  }
  const reqHeaders = filterRequestHeaders(c.req.raw.headers)

  const {
    body,
    message,
    createNs,
    createRepo,
    bodyWorkspaceId,
    moveNewPath,
    copyFrom,
    restoreFrom,
    rejection,
  } = await interpretRequestBody(c, user, method, pathname, url.searchParams, reqHeaders)

  const decision = await authorizeApiRequest({
    user,
    via,
    method,
    pathname,
    createNamespace: createNs,
    createRepo: createRepo,
  })
  if (!decision.allow) {
    return new Response(
      JSON.stringify({
        status: 'error',
        status_message: 'forbidden',
        error: { detail: decision.reason },
      }),
      {
        status: 403,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  if (rejection) {
    const classified = interpretRequest(method, pathname)
    return rejectUnclassifiedWrite(user, via, method, pathname, rejection, {
      namespace: classified.namespace ?? createNs,
      repo: classified.repo ?? createRepo,
    })
  }

  const mutating = method !== 'GET' && method !== 'HEAD'
  const classified = interpretRequest(method, pathname)
  const ns = classified.namespace ?? createNs
  const repo = classified.repo ?? createRepo

  if (mutating && isDatasetMutation(classified.action) && auditChainBlocked()) return auditChainBroken()

  let reason: ResolvedReason | undefined
  if (mutating && isDatasetMutation(classified.action)) {
    const resolved = resolveReason({ actor: user, explicit: c.req.header(REASON_HEADER), message })
    if (!resolved.ok) {
      return rejectReason(user, via, method, pathname, resolved.rejection, { namespace: ns, repo })
    }
    reason = resolved.value
  }

  if (decision.siteAdminBypass) {
    await recordSiteAdminBypass({
      user,
      via,
      method,
      pathname,
      namespace: createNs,
      repo: createRepo,
      reason: decision.reason,
    })
  }


  const lineage = createLineageCapture({
    method,
    pathname,
    moveNewPath,
    copyFrom,
    restoreFrom,
    user,
    via,
    fetchImpl: (input, init) => upstreamFetch(input, init),
  })

  const datasetVersions = createDatasetCapture({
    method,
    pathname,
    action: classified.action,
    fetchImpl: (input, init) => upstreamFetch(input, init),
  })

  const auditFields = (status: number, versions: DatasetVersions = {}) => ({
    actor: actorFromUser(user),
    via,
    method,
    path: pathname,
    status,
    action: classified.action,
    namespace: ns,
    repo,
    message,
    ...reason,
    ...versions,
    detail: {
      ...(bodyWorkspaceId ? { workspace_id: bodyWorkspaceId } : {}),
      ...classified.detail,
      ...(moveNewPath ? { new_path: moveNewPath } : {}),
      ...(copyFrom ? { copy_from: copyFrom } : {}),
      ...(restoreFrom ? { restore_from: restoreFrom } : {}),
      ...(lineage.kind() ? { lineage_kind: lineage.kind() } : {}),
    },
  })

  // Fail closed: nothing reaches oxen unless the intent is on the chain.
  let intent: AuditEvent | undefined
  if (mutating) {
    try {
      intent = await appendIntent(auditFields(0))
    } catch {
      return auditUnavailable()
    }
  }

  let upstream: Response
  try {
    await lineage.before()
    if (mutating) await datasetVersions.before()
    upstream = await upstreamFetch(
      `${env.oxenUpstream}${pathname}${url.search}`,
      {
        method,
        headers: reqHeaders,
        body,
        redirect: 'manual',
      },
    )
  } catch (err) {
    if (intent) await appendOutcome(intent.id, auditFields(502))
    throw err
  }

  let responseBody: BodyInit | null = upstream.body

  const filteredCatalog = await filterNamespaceCatalog(user, method, pathname, upstream)
  if (filteredCatalog !== null) responseBody = filteredCatalog

  if (intent) {
    // Buffered once: the dataset versions and the lineage op both read the answer, and the caller is served it.
    let buffered: string | undefined
    if (upstream.ok && (upstream.headers.get('content-type') ?? '').includes('application/json')) {
      try {
        buffered = await upstream.text()
      } catch {
        buffered = undefined
      }
    }
    if (buffered !== undefined) responseBody = buffered

    const auditEvent = await appendOutcome(intent.id, auditFields(upstream.status, datasetVersions.after(upstream, buffered)))
    await lineage.after(upstream, buffered, auditEvent?.id)

    // After successful repo create: seed AuthZ namespace + creator Admin
    if (
      upstream.ok &&
      (classified.action === 'repo.create' ||
        (pathname === '/api/repos' && method === 'POST')) &&
      ns &&
      repo
    ) {
      await seedRepoCreate(user, ns, repo)
    }
  }

  const resHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return
    resHeaders.set(key, value)
  })
  // Body may have been rewritten (namespace ACL filter / lineage buffer).
  if (typeof responseBody === 'string') {
    resHeaders.delete('content-length')
  }

  return new Response(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  })
}
