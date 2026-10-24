import type { Context } from 'hono'
import { env } from './env.js'
import type { SessionUser } from './session.js'
import {
  actorFromUser,
  appendAudit,
  type AuditVia,
} from './audit.js'
import { createLineageCapture } from './proxyLineage.js'
import { authorizeApiRequest } from './authz.js'
import { interpretRequest } from './requestInterpretation.js'
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
])

function filterRequestHeaders(headers: Headers): Headers {
  const out = new Headers()
  headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return
    out.set(key, value)
  })
  return out
}

function rejectUnclassifiedWrite(
  user: SessionUser,
  via: AuditVia,
  method: string,
  pathname: string,
  reason: string,
  scope: { namespace?: string; repo?: string } = {},
): Response {
  appendAudit({
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

  const decision = authorizeApiRequest({
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

  if (decision.siteAdminBypass) {
    recordSiteAdminBypass({
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
  await lineage.before()

  const upstream = await upstreamFetch(
    `${env.oxenUpstream}${pathname}${url.search}`,
    {
      method,
      headers: reqHeaders,
      body,
      redirect: 'manual',
    },
  )

  let responseBody: BodyInit | null = upstream.body

  const filteredCatalog = await filterNamespaceCatalog(user, method, pathname, upstream)
  if (filteredCatalog !== null) responseBody = filteredCatalog

  if (method !== 'GET' && method !== 'HEAD') {
    const classified = interpretRequest(method, pathname)
    const ns = classified.namespace ?? createNs
    const repo = classified.repo ?? createRepo

    const auditEvent = appendAudit({
      actor: actorFromUser(user),
      via,
      method,
      path: pathname,
      status: upstream.status,
      action: classified.action,
      namespace: ns,
      repo,
      message,
      detail: {
        ...(bodyWorkspaceId ? { workspace_id: bodyWorkspaceId } : {}),
        ...classified.detail,
        ...(moveNewPath ? { new_path: moveNewPath } : {}),
        ...(copyFrom ? { copy_from: copyFrom } : {}),
        ...(restoreFrom ? { restore_from: restoreFrom } : {}),
        ...(lineage.kind() ? { lineage_kind: lineage.kind() } : {}),
      },
    })

    const buffered = await lineage.after(upstream, auditEvent?.id)
    if (buffered !== undefined) responseBody = buffered

    // After successful repo create: seed AuthZ namespace + creator Admin
    if (
      upstream.ok &&
      (classified.action === 'repo.create' ||
        (pathname === '/api/repos' && method === 'POST')) &&
      ns &&
      repo
    ) {
      seedRepoCreate(user, ns, repo)
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
