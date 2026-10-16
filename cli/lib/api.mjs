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
