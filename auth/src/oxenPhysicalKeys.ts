/**
 * Physical oxen keys = Mice stable ids (`.specs/05-repositories.md`).
 * Clients and AuthZ decisions use display names; oxen paths use UUIDs.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isPhysicalOxenKey(value: string): boolean {
  return UUID_RE.test(value.trim())
}

export type PhysicalRepoRef = {
  namespaceId: string
  repositoryId: string
}

export type DisplayRepoRef = {
  namespace: string
  repo: string
}

/** Rewrite `/api/repos/:ns/:repo/...` display segments to physical UUID segments. */
export function rewriteReposApiPathToPhysical(
  pathname: string,
  physical: PhysicalRepoRef | null,
): string {
  if (!physical) return pathname
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'repos' || parts.length < 4) return pathname
  parts[2] = encodeURIComponent(physical.namespaceId)
  parts[3] = encodeURIComponent(physical.repositoryId)
  return `/${parts.join('/')}`
}

/** Rewrite `/api/repos/:ns` (list) display namespace to physical namespace id. */
export function rewriteRepoListPathToPhysical(pathname: string, namespaceId: string | null): string {
  if (!namespaceId) return pathname
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'repos' || parts.length !== 3) return pathname
  parts[2] = encodeURIComponent(namespaceId)
  return `/${parts.join('/')}`
}

/** Rewrite `/api/namespaces/:ns` display → physical. */
export function rewriteNamespacePathToPhysical(pathname: string, namespaceId: string | null): string {
  if (!namespaceId) return pathname
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'namespaces' || parts.length < 3) return pathname
  parts[2] = encodeURIComponent(namespaceId)
  return `/${parts.join('/')}`
}

function rewriteRepoObject(
  obj: Record<string, unknown>,
  resolveNamespace: (id: string) => string | null | undefined,
  resolveRepo: (namespaceId: string, repositoryId: string) => DisplayRepoRef | null | undefined,
): void {
  const nsId = typeof obj.namespace === 'string' ? obj.namespace : null
  const repoId = typeof obj.name === 'string' ? obj.name : null
  if (nsId && isPhysicalOxenKey(nsId) && repoId && isPhysicalOxenKey(repoId)) {
    const ref = resolveRepo(nsId, repoId)
    if (ref) {
      obj.namespace = ref.namespace
      obj.name = ref.repo
      return
    }
  }
  if (nsId && isPhysicalOxenKey(nsId)) {
    const display = resolveNamespace(nsId)
    if (display) obj.namespace = display
  }
}

/**
 * Swap physical UUID ns/repo fields in a proxied JSON body back to display names.
 * Walks common oxen shapes: repository, repositories[], namespace, namespaces[].
 */
export function rewriteOxenJsonToDisplay(
  body: string,
  resolveNamespace: (id: string) => string | null | undefined,
  resolveRepo: (namespaceId: string, repositoryId: string) => DisplayRepoRef | null | undefined,
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!node || typeof node !== 'object') return
    const obj = node as Record<string, unknown>

    if ('repositories' in obj && Array.isArray(obj.repositories)) {
      for (const r of obj.repositories) {
        if (r && typeof r === 'object') {
          rewriteRepoObject(r as Record<string, unknown>, resolveNamespace, resolveRepo)
        }
      }
    }
    if ('repository' in obj && obj.repository && typeof obj.repository === 'object') {
      rewriteRepoObject(obj.repository as Record<string, unknown>, resolveNamespace, resolveRepo)
    }
    // Repo-shaped object at this node (detail payloads sometimes flatten).
    if (typeof obj.namespace === 'string' && typeof obj.name === 'string') {
      rewriteRepoObject(obj, resolveNamespace, resolveRepo)
    }
    if ('namespaces' in obj && Array.isArray(obj.namespaces)) {
      for (const n of obj.namespaces) {
        if (!n || typeof n !== 'object') continue
        const row = n as Record<string, unknown>
        for (const key of ['namespace', 'name'] as const) {
          const v = row[key]
          if (typeof v === 'string' && isPhysicalOxenKey(v)) {
            const display = resolveNamespace(v)
            if (display) row[key] = display
          }
        }
      }
    }
    if (typeof obj.namespace === 'string' && isPhysicalOxenKey(obj.namespace) && !('name' in obj)) {
      const display = resolveNamespace(obj.namespace)
      if (display) obj.namespace = display
    }

    for (const v of Object.values(obj)) visit(v)
  }

  visit(parsed)
  return JSON.stringify(parsed)
}

/** Build oxen create body using physical keys; keep other fields. */
export function physicalCreateBody(
  rawBody: string | undefined,
  physical: PhysicalRepoRef,
): string {
  let parsed: Record<string, unknown> = {}
  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      parsed = {}
    }
  }
  return JSON.stringify({
    ...parsed,
    namespace: physical.namespaceId,
    name: physical.repositoryId,
  })
}
