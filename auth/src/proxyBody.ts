import type { Context } from 'hono'
import {
  hasAuthorQueryParam,
  isAuthorFreeBinaryRoute,
  injectAuthorFormData,
  injectAuthorJson,
} from './author.js'
import {
  extractMessageFromForm,
  extractMessageFromJson,
  extractRepoCreateFromJson,
} from './audit.js'
import type { SessionUser } from './session.js'

/** What the proxy learned from the request body, with author fields forced to the Principal. */
export type InterpretedBody = {
  body: BodyInit | undefined
  message?: string
  createNs?: string
  createRepo?: string
  bodyWorkspaceId?: string
  moveNewPath?: string
  copyFrom?: string
  restoreFrom?: string
  /** Applied after authorization so unauthorized Principals get 403, not 400. */
  rejection?: string
}

export async function interpretRequestBody(
  c: Context,
  user: SessionUser,
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  reqHeaders: Headers,
): Promise<InterpretedBody> {
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
          } else if (
            method === 'DELETE' &&
            /\/workspaces\/[^/]+\/(?:changes|files)\/?$/.test(pathname) &&
            Array.isArray(value) &&
            value.every((v) => typeof v === 'string')
          ) {
            // Unstage sends an all-string path array, which cannot carry author fields.
            body = text
            reqHeaders.set('content-type', 'application/json')
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
    hasAuthorQueryParam(searchParams)
  ) {
    rejection = 'author_in_query'
  }

  return {
    body,
    message,
    createNs,
    createRepo,
    bodyWorkspaceId,
    moveNewPath,
    copyFrom,
    restoreFrom,
    rejection,
  }
}
