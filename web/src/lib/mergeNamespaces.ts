import type { AuthzNamespaceSummary } from './authzApi'
import type { CatalogNamespace } from './catalog'

export type MergedNamespace = {
  name: string
  repoCount: number
  workspaceCount: number
  storageGb: number
  authz: AuthzNamespaceSummary | null
  onOxen: boolean
}

/** Union oxen catalog namespaces with AuthZ-only (empty) namespaces. */
export function mergeNamespaces(
  oxen: CatalogNamespace[],
  authzList: AuthzNamespaceSummary[],
): MergedNamespace[] {
  const byName = new Map<string, MergedNamespace>()
  for (const ns of oxen) {
    byName.set(ns.namespace, {
      name: ns.namespace,
      repoCount: ns.repoCount,
      workspaceCount: ns.workspaceCount,
      storageGb: ns.storageGb,
      authz: null,
      onOxen: true,
    })
  }
  for (const a of authzList) {
    const cur = byName.get(a.name)
    if (cur) {
      cur.authz = a
    } else {
      byName.set(a.name, {
        name: a.name,
        repoCount: 0,
        workspaceCount: 0,
        storageGb: 0,
        authz: a,
        onOxen: false,
      })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
