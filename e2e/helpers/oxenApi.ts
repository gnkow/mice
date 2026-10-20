/** Direct oxen-server helpers for setup / teardown (not mocked). */

const OXEN_URL = process.env.OXEN_URL ?? 'http://127.0.0.1:3001'

export type Json = Record<string, unknown>

async function api<T = Json>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${OXEN_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
  })
  const text = await res.text()
  let body = {} as T
  if (text) {
    try {
      body = JSON.parse(text) as T
    } catch {
      body = { raw: text } as T
    }
  }
  return { status: res.status, body }
}

export function uniqueId(prefix = 'mice-e2e'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export async function createRepo(namespace: string, name: string) {
  const { status, body } = await api('/api/repos', {
    method: 'POST',
    body: JSON.stringify({ namespace, name }),
  })
  if (status >= 400) {
    throw new Error(`createRepo failed ${status}: ${JSON.stringify(body)}`)
  }
  return body
}

export async function deleteRepo(namespace: string, name: string) {
  await api(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
}

export async function putFile(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
  content: string | Buffer | Uint8Array,
  message: string,
  filename?: string,
) {
  const form = new FormData()
  const name = filename ?? path.split('/').pop() ?? 'file.txt'
  const bytes =
    typeof content === 'string'
      ? new Blob([content], { type: 'text/plain' })
      : new Blob([content])
  form.append('file', bytes, name)
  form.append('message', message)
  form.append('name', 'Mice E2E')
  form.append('email', 'e2e@mice.local')
  const resource = [branch, ...path.split('/').filter(Boolean)].join('/')
  const { status, body } = await api(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/file/${resource}`,
    { method: 'PUT', body: form },
  )
  if (status >= 400) {
    throw new Error(`putFile failed ${status}: ${JSON.stringify(body)}`)
  }
  return body as { commit?: { id: string } }
}

export async function createBranch(
  namespace: string,
  repo: string,
  name: string,
  fromBranch = 'main',
) {
  const { status, body } = await api(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/branches`,
    {
      method: 'POST',
      body: JSON.stringify({ new_name: name, from_name: fromBranch }),
    },
  )
  if (status >= 400) {
    throw new Error(`createBranch failed ${status}: ${JSON.stringify(body)}`)
  }
  return body
}

export async function listBranches(namespace: string, repo: string) {
  const { body } = await api<{
    branches?: { name: string; commit_id: string }[]
  }>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/branches`,
  )
  return body.branches ?? []
}

export async function updateBranchTip(
  namespace: string,
  repo: string,
  branch: string,
  commitId: string,
) {
  const { status, body } = await api(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ commit_id: commitId }),
    },
  )
  if (status >= 400) {
    throw new Error(`updateBranchTip failed ${status}: ${JSON.stringify(body)}`)
  }
  return body
}

export async function getFileEntry(
  namespace: string,
  repo: string,
  branch: string,
  path: string,
) {
  const resource = [branch, ...path.split('/').filter(Boolean)].join('/')
  const { status, body } = await api<{
    entry?: { hash?: string; filename?: string; size?: number }
  }>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/meta/${resource}`,
  )
  if (status >= 400) {
    throw new Error(`getFileEntry failed ${status}: ${JSON.stringify(body)}`)
  }
  return body.entry
}

export async function getCommit(
  namespace: string,
  repo: string,
  commitId: string,
) {
  const { status, body } = await api<{
    commit?: { id: string; author: string; email: string; message: string }
  }>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(commitId)}`,
  )
  if (status >= 400) {
    throw new Error(`getCommit failed ${status}: ${JSON.stringify(body)}`)
  }
  return body.commit
}

export async function createWorkspace(
  namespace: string,
  repo: string,
  branchName: string,
  name: string,
) {
  const workspaceId = crypto.randomUUID()
  const { status, body } = await api<{
    workspace?: { id: string; name?: string }
  }>(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/workspaces`,
    {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: workspaceId,
        branch_name: branchName,
        name,
      }),
    },
  )
  if (status >= 400) {
    throw new Error(`createWorkspace failed ${status}: ${JSON.stringify(body)}`)
  }
  return body.workspace ?? { id: workspaceId, name }
}

export async function waitForOxen(timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const { status } = await api('/api/version')
      if (status === 200) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`oxen-server not reachable at ${OXEN_URL}`)
}

export { OXEN_URL, api }
