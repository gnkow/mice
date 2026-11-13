import { getNamespace } from './authzNamespaceStore.js'
import { readNamespaceById } from './authzRepository.js'
import { readRepository, readRepositoryById } from './repositoryStore.js'
import type { FavoriteType } from './favoritesStore.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

export type CanonicalFavorite = {
  /** Stored favorite id (entity UUID, or UUID@branch / UUID!workspace). */
  id: string
  /** Name-shaped id for meta resolveRef / existence checks. */
  metaId: string
  namespace?: string
  repo?: string
}

/**
 * Turn a client favorite target into a stable entity-UUID key (ticket 03) while
 * keeping a name-shaped meta id for resolveRef.
 */
export async function canonicalizeFavorite(
  type: FavoriteType,
  rawId: string,
): Promise<CanonicalFavorite | null> {
  const id = rawId.trim()
  if (!id) return null

  if (type === 'namespace') {
    if (looksLikeUuid(id)) {
      const ns = await readNamespaceById(id)
      if (!ns) return null
      return { id: ns.id, metaId: ns.name, namespace: ns.name }
    }
    const ns = await getNamespace(id)
    if (!ns) return null
    return { id: ns.id, metaId: ns.name, namespace: ns.name }
  }

  if (type === 'repo') {
    if (looksLikeUuid(id)) {
      const repo = await readRepositoryById(id)
      if (!repo) return null
      return {
        id: repo.id,
        metaId: `${repo.namespace}/${repo.name}`,
        namespace: repo.namespace,
        repo: repo.name,
      }
    }
    const slash = id.indexOf('/')
    if (slash <= 0 || slash !== id.lastIndexOf('/')) return null
    const ns = id.slice(0, slash)
    const name = id.slice(slash + 1)
    const repo = await readRepository(ns, name)
    if (!repo) return null
    return {
      id: repo.id,
      metaId: `${repo.namespace}/${repo.name}`,
      namespace: repo.namespace,
      repo: repo.name,
    }
  }

  if (type === 'branch' || type === 'stage') {
    const sep = type === 'branch' ? '@' : '!'
    const i = id.indexOf(sep)
    if (i <= 0 || i === id.length - 1) return null
    const left = id.slice(0, i)
    const right = id.slice(i + 1)
    if (looksLikeUuid(left)) {
      const repo = await readRepositoryById(left)
      if (!repo) return null
      return {
        id: `${repo.id}${sep}${right}`,
        metaId: `${repo.namespace}/${repo.name}${sep}${right}`,
        namespace: repo.namespace,
        repo: repo.name,
      }
    }
    const slash = left.indexOf('/')
    if (slash <= 0) return null
    const ns = left.slice(0, slash)
    const name = left.slice(slash + 1)
    const repo = await readRepository(ns, name)
    if (!repo) return null
    return {
      id: `${repo.id}${sep}${right}`,
      metaId: `${repo.namespace}/${repo.name}${sep}${right}`,
      namespace: repo.namespace,
      repo: repo.name,
    }
  }

  // job / session stay opaque string ids
  return { id, metaId: id }
}
