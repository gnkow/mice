import type { Context } from 'hono'
import { env } from './env.js'
import { injectAuthorFormData, injectAuthorJson } from './author.js'
import type { SessionUser } from './session.js'

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

export async function proxyToOxen(
  c: Context,
  user: SessionUser | null,
): Promise<Response> {
  const url = new URL(c.req.url)
  const target = `${env.oxenUpstream}${url.pathname}${url.search}`
  const method = c.req.method
  const reqHeaders = filterRequestHeaders(c.req.raw.headers)

  let body: BodyInit | undefined
  const contentType = c.req.header('content-type') ?? ''

  if (method !== 'GET' && method !== 'HEAD') {
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData()
      body = user ? injectAuthorFormData(form, user) : form
      // Let fetch set multipart boundary
      reqHeaders.delete('content-type')
    } else if (contentType.includes('application/json')) {
      const text = await c.req.text()
      if (text) {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>
          const injected = user ? injectAuthorJson(parsed, user) : parsed
          body = JSON.stringify(injected)
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

  const upstream = await fetch(target, {
    method,
    headers: reqHeaders,
    body,
    redirect: 'manual',
  })

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
