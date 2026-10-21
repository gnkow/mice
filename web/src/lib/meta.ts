export const ENTITY_TYPES = [
  'namespace',
  'repo',
  'branch',
  'commit',
  'directory',
  'file',
  'workspace',
  'job',
  'session',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export type EntityRef = {
  type: EntityType
  id: string
  namespace?: string
  repo?: string
  scope?: { kind: 'branch' | 'commit'; id: string }
}

export type MetaTarget = { type: string; id: string; scope?: EntityRef['scope'] }
export type Coverage = { complete: boolean; description: string }

export function metaParams(ref: MetaTarget): URLSearchParams {
  const p = new URLSearchParams({ type: ref.type, id: ref.id })
  if (ref.scope) {
    p.set('scope', ref.scope.kind)
    p.set('revision', ref.scope.id)
  }
  return p
}

export function metaKey(ref: MetaTarget): string {
  return ref.scope
    ? `scoped:${JSON.stringify([ref.type, ref.id, ref.scope.kind, ref.scope.id])}`
    : `${ref.type}:${ref.id}`
}

export type EffectiveMeta = {
  tags: { value: string }[]
  labels: Record<string, { value: string }>
}

export type OwnRecord = {
  ref: EntityRef
  tags: string[]
  labels: Record<string, string>
  revision: number
  updatedAt: string
}

export type MetaView = {
  revision: number
  version: string
  ref: EntityRef
  own: OwnRecord | null
  effective: EffectiveMeta
  canEdit: boolean
}

export type MetaPatch = {
  tags?: string[]
  labels?: Record<string, string | null>
}

export type SearchHit = {
  ref: EntityRef
  name: string
  url: string
  score: number
  updatedAt?: string
  effective: EffectiveMeta
}

export type SearchResponse = {
  coverage: Coverage
  hits: SearchHit[]
  nextCursor: string | null
  total: number
  facets: {
    types: Record<string, number>
    tags: Record<string, number>
    labelKeys: Record<string, number>
  }
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let msg = `${what} failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      /* ignore */
    }
    throw new MetaApiError(msg, res.status)
  }

  return (await res.json()) as T
}

export class MetaApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const opts: RequestInit = { credentials: 'same-origin' }

export async function fetchMeta(
  type: string,
  id: string,
  signal?: AbortSignal,
  scope?: EntityRef['scope'],
): Promise<MetaView> {
  const p = metaParams({ type, id, scope })
  return json(await fetch(`/auth/meta?${p}`, { ...opts, signal }), 'Load metadata')
}

export async function saveMeta(
  ref: MetaTarget,
  patch: MetaPatch,
  ifRevision?: number,
  ifVersion?: string,
): Promise<{ ok: boolean; revision: number; own: OwnRecord | null }> {
  invalidateMetaCache()
  return json(
    await fetch('/auth/meta', {
      ...opts,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, ...patch, ifRevision, ifVersion }),
    }),
    'Save metadata',
  )
}

export async function deleteMeta(ref: MetaTarget, ifRevision?: number, ifVersion?: string): Promise<void> {
  invalidateMetaCache()
  const p = metaParams(ref)
  if (ifRevision !== undefined) p.set('ifRevision', String(ifRevision))
  if (ifVersion !== undefined) p.set('ifVersion', ifVersion)
  await json(await fetch(`/auth/meta?${p}`, { ...opts, method: 'DELETE' }), 'Delete metadata')
}

export function searchParams(q: {
  q?: string
  type?: string
  tag?: string
  namespace?: string
  repo?: string
  cursor?: string
}): URLSearchParams {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v)
  return p
}

export async function searchMeta(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  return json(await fetch(`/auth/meta/search?${params}`, { ...opts, signal }), 'Search')
}

export function metaLink(ref: MetaTarget): string {
  return `/meta?${metaParams(ref)}`
}

export type HistoryEntry = {
  revision: number
  ts: string
  actor: { name: string; email: string }
  op: 'set' | 'delete'
  before: OwnRecord | null
  after: OwnRecord | null
}

export async function fetchMetaHistory(
  type: string,
  id: string,
  signal?: AbortSignal,
  scope?: EntityRef['scope'],
): Promise<HistoryEntry[]> {
  const p = metaParams({ type, id, scope })
  const r = await json<{ history: HistoryEntry[] }>(
    await fetch(`/auth/meta/history?${p}`, { ...opts, signal }),
    'Load history',
  )
  return r.history
}

export function entityMetaUrl(ref: MetaTarget): string {
  return metaLink(ref)
}

/** Known ids for a type: live entities where a list API exists, plus ones already annotated. */
export async function fetchEntityOptions(type: string, signal?: AbortSignal): Promise<string[]> {
  const out = new Set<string>()
  const safe = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch {
      /* best effort */
    }
  }
  await safe(async () => {
    const hits = await searchMeta(searchParams({ type }), signal)
    for (const h of hits.hits) out.add(h.ref.id)
  })
  await safe(async () => {
    if (type === 'namespace' || type === 'repo') {
      const { listNamespaces, listRepositories } = await import('./oxen/api')
      const nss = (await listNamespaces(signal)).namespaces.map((n) => n.namespace)
      if (type === 'namespace') nss.forEach((n) => out.add(n))
      else {
        for (const ns of nss.slice(0, 30)) {
          const r = await listRepositories(ns, signal).catch(() => null)
          r?.repositories.forEach((x) => out.add(`${x.namespace}/${x.name}`))
        }
      }
    } else if (type === 'job') {
      const { listJobs } = await import('./jobs')
      ;(await listJobs({ limit: 100 }, signal)).jobs.forEach((j) => out.add(j.id))
    } else if (type === 'session') {
      const { listSessions } = await import('./sessions')
      ;(await listSessions(signal)).sessions.forEach((s) => out.add(s.id))
    }
  })
  return [...out].sort()
}

const BATCH_TTL_MS = 30_000
const batchCache = new Map<string, { at: number; value: Promise<EffectiveMeta | null> }>()
let batchQueue: { key: string; ref: MetaTarget; resolve: (v: EffectiveMeta | null) => void }[] = []
let batchTimer: ReturnType<typeof setTimeout> | null = null

async function flushBatch() {
  const queue = batchQueue
  batchQueue = []
  batchTimer = null
  for (let i = 0; i < queue.length; i += 200) {
    const chunk = queue.slice(i, i + 200)
    try {
      const res = await fetch('/auth/meta/batch', {
        ...opts,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refs: chunk.map((q) => q.ref) }),
      })
      const { items } = await json<{ items: Record<string, EffectiveMeta> }>(res, 'Load metadata')
      for (const q of chunk) q.resolve(items[q.key] ?? null)
    } catch {
      for (const q of chunk) q.resolve(null)
    }
  }
}

/** Explicit metadata for list rows; calls made in the same tick share one request. */
export function loadEffectiveMeta(ref: MetaTarget): Promise<EffectiveMeta | null> {
  const key = metaKey(ref)
  const hit = batchCache.get(key)
  if (hit && Date.now() - hit.at < BATCH_TTL_MS) return hit.value
  const value = new Promise<EffectiveMeta | null>((resolve) => {
    batchQueue.push({ key, ref, resolve })
    batchTimer ??= setTimeout(() => void flushBatch(), 0)
  })
  batchCache.set(key, { at: Date.now(), value })
  return value
}

export function invalidateMetaCache() {
  batchCache.clear()
}
