import {
  getNamespace,
  listNamespaces,
  listRepositories,
  listWorkspaces,
} from './oxen/api'

export type CatalogRepo = {
  namespace: string
  name: string
}

export type CatalogNamespace = {
  namespace: string
  storageGb: number
  repoCount: number
  workspaceCount: number
  repos: CatalogRepo[]
}

export type CatalogWorkspace = {
  namespace: string
  repo: string
  id: string
  name: string
  createdAt?: string | null
}

export type Catalog = {
  namespaces: CatalogNamespace[]
  repositories: CatalogRepo[]
  workspaces: CatalogWorkspace[]
  storageBytes: number
}

export async function loadCatalog(signal: AbortSignal): Promise<Catalog> {
  const nsRes = await listNamespaces(signal)
  const namespaces: CatalogNamespace[] = []
  const repositories: CatalogRepo[] = []
  const workspaces: CatalogWorkspace[] = []
  let storageBytes = 0

  for (const ns of nsRes.namespaces) {
    const [detail, reposRes] = await Promise.all([
      getNamespace(ns.namespace, signal).catch(() => null),
      listRepositories(ns.namespace, signal).catch(() => null),
    ])
    const storageGb = detail?.namespace.storage_usage_gb ?? 0
    storageBytes += storageGb * 1024 ** 3
    const repos = (reposRes?.repositories ?? []).map((r) => ({
      namespace: ns.namespace,
      name: r.name,
    }))
    repositories.push(...repos)

    const wsLists = await Promise.all(
      repos.map((r) =>
        listWorkspaces(r.namespace, r.name, signal)
          .then((res) =>
            res.workspaces.map((w) => ({
              namespace: r.namespace,
              repo: r.name,
              id: w.id,
              name: w.name || w.id,
              createdAt: w.created_at,
            })),
          )
          .catch(() => [] as CatalogWorkspace[]),
      ),
    )
    const nsWorkspaces = wsLists.flat()
    workspaces.push(...nsWorkspaces)

    namespaces.push({
      namespace: ns.namespace,
      storageGb,
      repoCount: repos.length,
      workspaceCount: nsWorkspaces.length,
      repos,
    })
  }

  return { namespaces, repositories, workspaces, storageBytes }
}
