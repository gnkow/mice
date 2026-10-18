/**
 * Jobs CLI helper: fetch JSON/text from the BFF and throw on non-OK.
 * @param {string} remote
 * @param {string} token
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function api(remote, token, path, init = {}) {
  const base = remote.replace(/\/$/, '')
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const ct = res.headers.get('content-type') || ''
  const body = ct.includes('application/json')
    ? await res.json()
    : await res.text()
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body && 'error' in body
        ? body.error
        : typeof body === 'string'
          ? body
          : res.statusText
    throw new Error(`${res.status}: ${msg}`)
  }
  return body
}

/**
 * Login / device-flow helper: return raw response pieces without throwing.
 * @param {string} remote
 * @param {string} path
 * @param {{ method?: string, token?: string | null, body?: unknown }} [opts]
 */
export async function bffFetch(remote, path, opts = {}) {
  const base = remote.replace(/\/$/, '')
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  let body
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { res, json, text }
}
