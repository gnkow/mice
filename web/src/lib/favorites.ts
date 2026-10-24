import { useCallback, useEffect, useSyncExternalStore } from 'react'

export const FAVORITE_TYPES = ['namespace', 'repo', 'branch', 'stage', 'job', 'session'] as const
export type FavoriteType = (typeof FAVORITE_TYPES)[number]
export type Favorite = { type: FavoriteType; id: string; at: string; namespace?: string; repo?: string; name?: string }

/** UI route for a favorite. */
export function favoriteHref(f: Favorite): string | null {
  const enc = encodeURIComponent
  switch (f.type) {
    case 'namespace': return `/n/${enc(f.id)}`
    case 'session': return `/sessions/${enc(f.id)}`
    case 'job': return f.namespace && f.repo ? `/n/${enc(f.namespace)}/r/${enc(f.repo)}/jobs/${enc(f.id)}` : null
    default: {
      if (!f.namespace || !f.repo) return null
      const base = `/n/${enc(f.namespace)}/r/${enc(f.repo)}`
      if (f.type === 'repo') return base
      const name = f.id.slice(f.id.search(/[@!]/) + 1)
      return f.type === 'branch' ? `${base}/branches/${enc(name)}` : `${base}/stages/${enc(name)}`
    }
  }
}

export function favoriteLabel(f: Favorite): string {
  if (f.name) return f.name
  return f.type === 'branch' || f.type === 'stage' ? f.id.slice(f.id.search(/[@!]/) + 1) : f.id
}


type Snapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: Favorite[]
}

let snapshot: Snapshot = { status: 'idle', items: [] }
const listeners = new Set<() => void>()

function set(next: Snapshot) {
  snapshot = next
  listeners.forEach((l) => l())
}

const keyOf = (type: string, id: string) => `${type}\0${id}`

async function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/auth/favorites${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  })
}

export async function refreshFavorites(): Promise<void> {
  if (snapshot.status === 'loading') return
  set({ ...snapshot, status: snapshot.status === 'ready' ? 'ready' : 'loading' })
  try {
    const res = await call('')
    if (!res.ok) throw new Error(String(res.status))
    const body = (await res.json()) as { items: Favorite[] }
    set({ status: 'ready', items: body.items })
  } catch {
    set({ ...snapshot, status: 'error' })
  }
}

/** Optimistic toggle with rollback on failure. Throws on failure after rolling back. */
export async function setFavorite(type: FavoriteType, id: string, on: boolean): Promise<void> {
  const before = snapshot
  const without = before.items.filter((f) => !(f.type === type && f.id === id))
  set({
    ...before,
    items: on ? [{ type, id, at: new Date().toISOString() }, ...without] : without,
  })
  try {
    const res = on
      ? await call('', { method: 'PUT', body: JSON.stringify({ type, id }) })
      : await call(`?${new URLSearchParams({ type, id })}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(String(res.status))
  } catch (err) {
    set({ ...snapshot, items: before.items })
    throw err
  }
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useFavorites() {
  const snap = useSyncExternalStore(subscribe, () => snapshot)
  useEffect(() => {
    if (snapshot.status === 'idle') void refreshFavorites()
  }, [])
  const has = useCallback(
    (type: FavoriteType, id: string) => snap.items.some((f) => f.type === type && f.id === id),
    [snap.items],
  )
  return { items: snap.items, ready: snap.status === 'ready', has }
}

/** Stable partition: favorites first; each group keeps `base` order (or input order). */
export function sortWithFavorites<T>(
  items: T[],
  isFavorite: (item: T) => boolean,
  base?: (a: T, b: T) => number,
): T[] {
  const ordered = base ? [...items].sort(base) : items
  const fav: T[] = []
  const rest: T[] = []
  for (const item of ordered) (isFavorite(item) ? fav : rest).push(item)
  return [...fav, ...rest]
}

export { keyOf as favoriteKey }
