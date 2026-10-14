import type { Context } from 'hono'
import { env } from './env.js'
import { injectAuthorFormData, injectAuthorJson } from './author.js'
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
import { authorizeApiRequest } from './authz.js'
import {
  ensureNamespaceForCreate,
  hasInstancePermission,
  isInstanceAdmin,
  setRepoCollaborator,
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
  const reqHeaders = filterRequestHeaders(c.req.raw.headers)

  let body: BodyInit | undefined
  const contentType = c.req.header('content-type') ?? ''
  let message: string | undefined
  let createNs: string | undefined
  let createRepo: string | undefined

  if (method !== 'GET' && method !== 'HEAD') {
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData()
      message = extractMessageFromForm(form)
      body = injectAuthorFormData(form, user)
      // Let fetch set multipart boundary
      reqHeaders.delete('content-type')
    } else if (contentType.includes('application/json')) {
      const text = await c.req.text()
      if (text) {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>
          message = extractMessageFromJson(parsed)
          const created = extractRepoCreateFromJson(parsed)
          createNs = created.namespace
          createRepo = created.repo
          body = JSON.stringify(injectAuthorJson(parsed, user))
          reqHeaders.set('content-type', 'application/json')
        } catch {
          body = text
        }
      }
    } else if (contentType.includes('application/octet-stream')) {
      body = await c.req.arrayBuffer()
      reqHeaders.set('content-type', 'application/octet-stream')
    } else {
      const buf = await c.req.arrayBuffer()
      if (buf.byteLength) body = buf
    }
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

  const upstream = await fetch(
    `${env.oxenUpstream}${pathname}${url.search}`,
    {
      method,
      headers: reqHeaders,
      body,
      redirect: 'manual',
    },
  )

  if (method !== 'GET' && method !== 'HEAD') {
    const classified = classifyPath(method, pathname)
    const ns = classified.namespace ?? createNs
    const repo = classified.repo ?? createRepo
    appendAudit({
      actor: actorFromUser(user),
      via,
      method,
      path: pathname,
      status: upstream.status,
      action: classified.action,
      namespace: ns,
      repo,
      message,
      detail: classified.detail,
    })

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

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  })
}
