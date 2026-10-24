import type { Context } from 'hono'
import { env } from './env.js'
import type { SessionUser } from './session.js'
import {
  actorFromUser,
  appendAudit,
  type AuditVia,
} from './audit.js'
import {
  buildExplicitFileOp,
  classifyFileLineageOp,
  fetchFileEntrySnapshot,
  parseCommitIdFromJson,
  type FileEntrySnapshot,
} from './lineage.js'
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

  // Before file mutate: snapshot prior entry so PUT can be upload vs edit
  // (or source entry for explicit copy / restore).
  let priorSnapshot: FileEntrySnapshot | null = null
  const tentativeFileOp = classifyFileLineageOp(method, pathname, {
    newPath: moveNewPath,
    copyFrom,
    restoreFrom,
  })
  if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    tentativeFileOp.namespace &&
    tentativeFileOp.repo &&
    tentativeFileOp.path &&
    (method === 'PUT' ||
      method === 'POST' ||
      method === 'DELETE' ||
      method === 'PATCH')
  ) {
    const snapshotRevision =
      tentativeFileOp.kind === 'restore' && restoreFrom
        ? restoreFrom
        : tentativeFileOp.branch
    if (snapshotRevision) {
      priorSnapshot = await fetchFileEntrySnapshot(
        tentativeFileOp.namespace,
        tentativeFileOp.repo,
        snapshotRevision,
        tentativeFileOp.path,
      )
    }
  }

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
  let commitId: string | undefined

  const filteredCatalog = await filterNamespaceCatalog(user, method, pathname, upstream)
  if (filteredCatalog !== null) responseBody = filteredCatalog

  if (method !== 'GET' && method !== 'HEAD') {
    const classified = interpretRequest(method, pathname)
    const ns = classified.namespace ?? createNs
    const repo = classified.repo ?? createRepo
    const fileOp = classifyFileLineageOp(method, pathname, {
      newPath: moveNewPath,
      priorExists: priorSnapshot != null,
      copyFrom,
      restoreFrom,
    })

    // Buffer small JSON mutate responses so we can parse commit id for lineage.
    if (upstream.ok && fileOp.kind) {
      const ct = upstream.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        try {
          const text = await upstream.text()
          responseBody = text
          try {
            commitId = parseCommitIdFromJson(JSON.parse(text) as unknown)
          } catch {
            /* ignore parse errors */
          }
        } catch {
          responseBody = upstream.body
        }
      }
    }

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
        ...(fileOp.kind ? { lineage_kind: fileOp.kind } : {}),
      },
    })

    if (upstream.ok && fileOp.kind && fileOp.namespace && fileOp.repo) {
      let contentHash: string | undefined
      // After write, resolve new content hash at branch tip (or new path for moves/copies).
      if (
        (fileOp.kind === 'upload' ||
          fileOp.kind === 'edit' ||
          fileOp.kind === 'restore' ||
          fileOp.kind === 'move' ||
          fileOp.kind === 'rename' ||
          fileOp.kind === 'copy') &&
        fileOp.branch
      ) {
        const outPath =
          fileOp.kind === 'move' ||
          fileOp.kind === 'rename' ||
          fileOp.kind === 'copy'
            ? (fileOp.newPath ?? moveNewPath)
            : fileOp.path
        if (outPath) {
          const after = await fetchFileEntrySnapshot(
            fileOp.namespace,
            fileOp.repo,
            fileOp.branch,
            outPath,
          )
          contentHash = after?.contentHash
        }
      }

      buildExplicitFileOp({
        kind: fileOp.kind,
        namespace: fileOp.namespace,
        repo: fileOp.repo,
        branch: fileOp.branch,
        path: fileOp.path,
        newPath: fileOp.newPath ?? moveNewPath,
        commitId,
        contentHash,
        priorContentHash: priorSnapshot?.contentHash,
        priorCommitId:
          priorSnapshot?.commitId ??
          (fileOp.kind === 'restore' ? restoreFrom : undefined),
        actor: actorFromUser(user),
        via,
        auditEventId: auditEvent?.id,
      })
    }

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
