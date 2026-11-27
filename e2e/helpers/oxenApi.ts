/**
 * Repo setup helpers for e2e.
 * Mutating calls go through the BFF (AuthZ + physical UUID rewrite).
 * Direct oxen is used only for health checks and validated-branch seeds.
 */

import { mintSessionCookie, type MintedSession } from './session'

const OXEN_URL = process.env.OXEN_URL ?? 'http://127.0.0.1:3001'
const BFF_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

export type Json = Record<string, unknown>

/** One suite cookie for BFF helpers — reminting per call invalidates the Playwright page session. */
let suiteSession: MintedSession | null = null

async function suiteCookieHeader(): Promise<string> {
  if (!suiteSession) suiteSession = await mintSessionCookie()
  return `${suiteSession.cookieName}=${suiteSession.cookieValue}`
}

/** Share the Playwright page cookie with BFF helpers. */
export function plantSuiteSession(session: MintedSession): void {
  suiteSession = session
}

/** Drop the cached suite cookie (e.g. after an intentional remint of e2e-user). */
export function clearSuiteSessionCache(): void {
  suiteSession = null
}

async function oxenApi<T = Json>(
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

async function bffApi<T = Json>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const cookie = await suiteCookieHeader()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    cookie,
    origin: BFF_URL,
    'x-mice-reason': 'e2e: oxenApi via BFF',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (init.body && !(init.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${BFF_URL}${path}`, { ...init, headers })
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

/** Claim AuthZ ownership of a namespace for the suite identity (idempotent on 409). */
export async function createNamespace(
  name: string,
  opts?: { basePermission?: string; membersCanCreateRepos?: boolean },
) {
  const { status, body } = await bffApi('/auth/namespaces', {
    method: 'POST',
    body: JSON.stringify({
      name,
      basePermission: opts?.basePermission ?? 'none',
      membersCanCreateRepos: opts?.membersCanCreateRepos ?? true,
    }),
  })
  if (status >= 400 && status !== 409) {
    throw new Error(`createNamespace failed ${status}: ${JSON.stringify(body)}`)
  }
  return body
}

/**
 * Claim a namespace as a specific minted session (e.g. a different Owner than the
 * suite identity). Does not change the cached suite cookie used by other helpers.
 */
export async function createNamespaceAs(
  session: MintedSession,
  name: string,
  opts?: { basePermission?: string; membersCanCreateRepos?: boolean },
) {
  const cookie = `${session.cookieName}=${session.cookieValue}`
  const res = await fetch(`${BFF_URL}/auth/namespaces`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      cookie,
      origin: BFF_URL,
      'x-mice-reason': 'e2e: create namespace as alternate owner',
    },
    body: JSON.stringify({
      name,
      basePermission: opts?.basePermission ?? 'none',
      membersCanCreateRepos: opts?.membersCanCreateRepos ?? true,
    }),
  })
  const text = await res.text()
  let body: Json = {}
  if (text) {
    try {
      body = JSON.parse(text) as Json
    } catch {
      body = { raw: text }
    }
  }
  if (res.status >= 400 && res.status !== 409) {
    throw new Error(`createNamespaceAs failed ${res.status}: ${JSON.stringify(body)}`)
  }
  return body
}

/** Delete a repo using a specific session (e.g. dest Owner after transfer). */
export async function deleteRepoAs(
  session: MintedSession,
  namespace: string,
  name: string,
) {
  const cookie = `${session.cookieName}=${session.cookieValue}`
  await fetch(
    `${BFF_URL}/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        cookie,
        origin: BFF_URL,
        'x-mice-reason': 'e2e: delete repo as alternate owner',
      },
    },
  )
}

/**
 * Seat a user as a non-owner namespace member (so the ns appears in their
 * transfer target list without making them dest Owner / one-shot eligible).
 */
export async function putNamespaceMemberAs(
  session: MintedSession,
  ns: string,
  member: { sub: string; iss: string; role: 'member' },
) {
  const cookie = `${session.cookieName}=${session.cookieValue}`
  const path = `/auth/namespaces/${encodeURIComponent(ns)}/members`
  const body = {
    kind: 'user' as const,
    sub: member.sub,
    iss: member.iss,
    role: member.role,
  }
  const reason = 'e2e: seat transfer proposer as dest namespace member'
  const sigRes = await fetch(`${AUTH_URL}/auth/dev/mutation-signature`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: BFF_URL,
      'x-mice-reason': reason,
    },
    body: JSON.stringify({ method: 'PUT', path, reason, body }),
  })
  if (!sigRes.ok) {
    throw new Error(
      `putNamespaceMemberAs signature failed ${sigRes.status}: ${await sigRes.text()}`,
    )
  }
  const { signatureId } = (await sigRes.json()) as { signatureId: string }
  const put = await fetch(`${AUTH_URL}${path}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: BFF_URL,
      'x-mice-reason': reason,
      'x-mice-signature-id': signatureId,
    },
    body: JSON.stringify(body),
  })
  if (!put.ok) {
    throw new Error(
      `putNamespaceMemberAs failed ${put.status}: ${await put.text()}`,
    )
  }
}

/** Create via BFF so AuthZ physical UUID keys match oxen. Namespace must already exist. */
export async function createRepo(namespace: string, name: string) {
  const { status, body } = await bffApi('/api/repos', {
    method: 'POST',
    body: JSON.stringify({ namespace, name }),
  })
  if (status >= 400) {
    throw new Error(`createRepo failed ${status}: ${JSON.stringify(body)}`)
  }
  return body
}

export async function deleteRepo(namespace: string, name: string) {
  await bffApi(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
}

/**
 * Seed a file on a validated branch (e.g. main) by writing oxen physical keys
 * directly — BFF blocks tip writes on validated branches.
 */
export async function putFileOnPhysical(
  namespaceId: string,
  repositoryId: string,
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
  const { status, body } = await oxenApi(
    `/api/repos/${encodeURIComponent(namespaceId)}/${encodeURIComponent(repositoryId)}/file/${resource}`,
    { method: 'PUT', body: form },
  )
  if (status >= 400) {
    throw new Error(`putFileOnPhysical failed ${status}: ${JSON.stringify(body)}`)
  }
  return body as { commit?: { id: string } }
}

/** Resolve AuthZ namespace id + repository id for physical oxen paths. */
export async function resolvePhysicalIds(
  namespace: string,
  repo: string,
): Promise<{ namespaceId: string; repositoryId: string }> {
  const cookie = await suiteCookieHeader()
  const headers = { Accept: 'application/json', cookie, origin: BFF_URL }
  const nsRes = await fetch(`${BFF_URL}/auth/namespaces/${encodeURIComponent(namespace)}`, {
    headers,
  })
  if (!nsRes.ok) {
    throw new Error(`resolvePhysicalIds namespace failed ${nsRes.status}: ${await nsRes.text()}`)
  }
  const nsBody = (await nsRes.json()) as { id: string }
  const repoRes = await fetch(
    `${BFF_URL}/auth/namespaces/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(repo)}`,
    { headers },
  )
  if (!repoRes.ok) {
    throw new Error(`resolvePhysicalIds repo failed ${repoRes.status}: ${await repoRes.text()}`)
  }
  const repoBody = (await repoRes.json()) as {
    repository?: { id?: string }
    id?: string
  }
  const repositoryId = repoBody.repository?.id ?? repoBody.id
  if (!repositoryId) {
    throw new Error(`resolvePhysicalIds missing repository id: ${JSON.stringify(repoBody)}`)
  }
  return { namespaceId: nsBody.id, repositoryId }
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
  const { status, body } = await bffApi(
    `/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/file/${resource}`,
    { method: 'PUT', body: form },
  )
  if (status === 403) {
    const detail = (body as { error?: { code?: string } }).error?.code
    if (detail === 'validated_branch') {
      const ids = await resolvePhysicalIds(namespace, repo)
      return putFileOnPhysical(
        ids.namespaceId,
        ids.repositoryId,
        branch,
        path,
        content,
        message,
        filename,
      )
    }
  }
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
  const { status, body } = await bffApi(
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
  const { body } = await bffApi<{
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
  const { status, body } = await bffApi(
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
  const { status, body } = await bffApi<{
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
  const { status, body } = await bffApi<{
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
  const { status, body } = await bffApi<{
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
      const { status } = await oxenApi('/api/version')
      if (status === 200) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`oxen-server not reachable at ${OXEN_URL}`)
}

export { OXEN_URL, oxenApi as api }
