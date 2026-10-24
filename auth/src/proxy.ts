import type { Context } from 'hono'
import { env } from './env.js'
import {
  hasAuthorQueryParam,
  isAuthorFreeBinaryRoute,
  injectAuthorFormData,
  injectAuthorJson,
} from './author.js'
import type { SessionUser } from './session.js'
import {
  actorFromUser,
  appendAudit,
  classifyPath,
  extractMessageFromForm,
  extractMessageFromJson,
  extractRepoCreateFromJson,
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
import { nonCanonicalPathReason } from './pathCanonical.js'
import {
  ensureNamespaceForCreate,
  hasInstancePermission,
  isAuthzEnforce,
  isInstanceAdmin,
  setRepoCollaborator,
  visibleNamespaceNames,
} from './authzStore.js'

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

  let body: BodyInit | undefined
  const contentType = (c.req.header('content-type') ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase()
  let message: string | undefined
  let createNs: string | undefined
  let bodyWorkspaceId: string | undefined
  let createRepo: string | undefined
  let moveNewPath: string | undefined
  let copyFrom: string | undefined
  let restoreFrom: string | undefined
  // Rejection is applied after authorization so unauthorized Principals get 403.
  let rejection: string | undefined

  if (method !== 'GET' && method !== 'HEAD') {
    if (contentType === 'multipart/form-data') {
      let form: FormData | undefined
      try {
        form = await c.req.formData()
      } catch {
        rejection = 'multipart_malformed'
      }
      if (form) {
        message = extractMessageFromForm(form)
        const copyField = form.get('copy_from')
        if (typeof copyField === 'string' && copyField.trim()) {
          copyFrom = copyField.trim().replace(/^\/+|\/+$/g, '')
        }
        const restoreField = form.get('restore_from')
        if (typeof restoreField === 'string' && restoreField.trim()) {
          restoreFrom = restoreField.trim()
        }
        // Mice-only hints for lineage; oxen-server must not see them.
        form.delete('copy_from')
        form.delete('restore_from')
        body = injectAuthorFormData(form, user)
        // Let fetch set multipart boundary
        reqHeaders.delete('content-type')
      }
    } else if (contentType === 'application/json') {
      const text = await c.req.text()
      if (text) {
        let parsed: Record<string, unknown> | undefined
        try {
          const value: unknown = JSON.parse(text)
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            parsed = value as Record<string, unknown>
          } else {
            rejection = 'json_not_object'
          }
        } catch {
          rejection = 'json_malformed'
        }
        if (parsed) {
          message = extractMessageFromJson(parsed)
          const created = extractRepoCreateFromJson(parsed)
          createNs = created.namespace
          createRepo = created.repo
          if (typeof parsed.workspace_id === 'string' && parsed.workspace_id.trim()) {
            bodyWorkspaceId = parsed.workspace_id.trim()
          }
          if (typeof parsed.new_path === 'string' && parsed.new_path.trim()) {
            moveNewPath = parsed.new_path.trim()
          }
          body = JSON.stringify(injectAuthorJson(parsed, user))
          reqHeaders.set('content-type', 'application/json')
        }
      }
    } else if (contentType === 'application/octet-stream') {
      body = await c.req.arrayBuffer()
      if (!isAuthorFreeBinaryRoute(method, pathname)) rejection = 'binary_on_unlisted_route'
      reqHeaders.set('content-type', 'application/octet-stream')
    } else if (contentType === 'application/gzip') {
      body = await c.req.arrayBuffer()
      if (!isAuthorFreeBinaryRoute(method, pathname)) rejection = 'binary_on_unlisted_route'
      reqHeaders.set('content-type', 'application/gzip')
    } else {
      // Author-bearing shapes are JSON/multipart; octet-stream and gzip are the author-free
      // allowlist. Any other non-empty body could smuggle author fields.
      const buf = await c.req.arrayBuffer()
      if (buf.byteLength) {
        rejection = 'unclassified_body'
      }
    }
  }

  if (
    !rejection &&
    method !== 'GET' &&
    method !== 'HEAD' &&
    hasAuthorQueryParam(url.searchParams)
  ) {
    rejection = 'author_in_query'
  }

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
    const classified = classifyPath(method, pathname)
    return rejectUnclassifiedWrite(user, via, method, pathname, rejection, {
      namespace: classified.namespace ?? createNs,
      repo: classified.repo ?? createRepo,
    })
  }

  if (decision.siteAdminBypass) {
    appendAudit({
      actor: actorFromUser(user),
      via,
      method,
      path: pathname,
      status: 0,
      action: 'site_admin_bypass',
      namespace: createNs,
      repo: createRepo,
      detail: { reason: decision.reason },
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

  const upstream = await fetch(
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

  // Filter oxen namespace catalog to AuthZ-visible namespaces under enforce.
  if (
    isAuthzEnforce() &&
    method === 'GET' &&
    (pathname.replace(/\/+$/, '') || '/') === '/api/namespaces' &&
    upstream.ok
  ) {
    const ct = upstream.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      try {
        const text = await upstream.text()
        try {
          const parsed = JSON.parse(text) as {
            namespaces?: Array<{ namespace?: string; name?: string }>
            [key: string]: unknown
          }
          const visible = visibleNamespaceNames(user)
          if (visible !== 'all' && Array.isArray(parsed.namespaces)) {
            const allow = new Set(visible)
            parsed.namespaces = parsed.namespaces.filter((n) => {
              const name = n.namespace ?? n.name ?? ''
              return allow.has(name)
            })
          }
          responseBody = JSON.stringify(parsed)
        } catch {
          responseBody = text
        }
      } catch {
        /* keep streamed body */
      }
    }
  }

  if (method !== 'GET' && method !== 'HEAD') {
    const classified = classifyPath(method, pathname)
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
      if (
        isInstanceAdmin(user) ||
        hasInstancePermission(user, 'create_namespace')
      ) {
        ensureNamespaceForCreate(user, ns, 'none')
      }
      void setRepoCollaborator(ns, repo, user, 'admin')
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
