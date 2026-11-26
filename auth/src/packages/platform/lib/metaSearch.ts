import {
  resolveEffective,
  type EffectiveMeta,
  type GetOwn,
} from './metaResolve.js'
import {
  metaUrl,
  refKey,
  refLabel,
  type EntityRef,
  type EntityType,
} from './metaTypes.js'

export type MetaSearchQuery = {
  q?: string
  types?: EntityType[]
  namespace?: string
  repo?: string
  tags?: string[]
  labels?: Record<string, string>
  limit?: number
  cursor?: string
}

export type MetaSearchHit = {
  ref: EntityRef
  name: string
  url: string
  score: number
  updatedAt?: string
  effective: EffectiveMeta['effective']
}

export type MetaFacets = {
  types: Record<string, number>
  tags: Record<string, number>
  labelKeys: Record<string, number>
}

export type SearchCtx = {
  candidates: EntityRef[]
  getOwn: GetOwn
  /** Applied inside the query, before paging. */
  canRead: (ref: EntityRef) => boolean | Promise<boolean>
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

type Term = { text: string; negate: boolean }

/** Splits free text into terms; supports "quoted phrases" and -negation. */
export function parseTerms(q: string): Term[] {
  const out: Term[] = []
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(q))) {
    const negate = (m[1] ?? m[3]) === '-'
    const text = (m[2] ?? m[4] ?? '').toLowerCase()
    if (text) out.push({ text, negate })
  }
  return out
}

/** Expands `tag:x`, `type:x`, `label.k:v` sugar into structured filters. */
export function parseQuerySyntax(q: string): {
  text: string
  types: EntityType[]
  tags: string[]
  labels: Record<string, string>
} {
  const types: EntityType[] = []
  const tags: string[] = []
  const labels: Record<string, string> = {}
  const rest: string[] = []
  const re = /(-?"[^"]+")|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(q))) {
    const tok = m[0]
    let hit = /^type:(\S+)$/i.exec(tok)
    if (hit) {
      types.push(hit[1].toLowerCase() as EntityType)
      continue
    }
    hit = /^tag:(\S+)$/i.exec(tok)
    if (hit) {
      tags.push(hit[1].toLowerCase())
      continue
    }
    hit = /^label\.([^:\s]+):(.+)$/i.exec(tok)
    if (hit) {
      labels[hit[1].toLowerCase()] = hit[2].replace(/^"|"$/g, '')
      continue
    }
    rest.push(tok)
  }
  return { text: rest.join(' '), types, tags, labels }
}

function nameOf(ref: EntityRef): string {
  return refLabel(ref)
}

function score(
  terms: Term[],
  ref: EntityRef,
  eff: EffectiveMeta['effective'],
): number | null {
  if (!terms.length) return 1
  const name = `${nameOf(ref)} ${ref.id}`.toLowerCase()
  const tags = eff.tags.map((t) => t.value.toLowerCase()).join(' ')
  const rest = Object.entries(eff.labels)
    .map(([k, v]) => `${k} ${v.value}`)
    .join(' ')
    .toLowerCase()
  let total = 0
  for (const t of terms) {
    const s =
      (name.includes(t.text) ? 4 : 0) +
      (tags.includes(t.text) ? 3 : 0) +
      (rest.includes(t.text) ? 1 : 0)
    if (t.negate) {
      if (s > 0) return null
    } else {
      if (s === 0) return null
      total += s
    }
  }
  return total || 1
}

function filtersMatch(
  q: MetaSearchQuery,
  eff: EffectiveMeta['effective'],
): boolean {
  for (const t of q.tags ?? []) {
    if (!eff.tags.some(x => x.value === t)) return false
  }
  for (const [k, v] of Object.entries(q.labels ?? {})) {
    const hit = eff.labels[k]
    if (!hit || hit.value.toLowerCase() !== v.toLowerCase()) return false
  }
  return true
}

export async function searchMeta(
  query: MetaSearchQuery,
  ctx: SearchCtx,
): Promise<{ hits: MetaSearchHit[]; nextCursor: string | null; total: number; facets: MetaFacets }> {
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT)
  const syntax = parseQuerySyntax(query.q ?? '')
  const q: MetaSearchQuery = {
    ...query,
    types: [...(query.types ?? []), ...syntax.types],
    tags: [...(query.tags ?? []), ...syntax.tags],
    labels: { ...syntax.labels, ...(query.labels ?? {}) },
  }
  const terms = parseTerms(syntax.text)

  const seen = new Set<string>()
  const hits: MetaSearchHit[] = []
  for (const ref of ctx.candidates) {
    const key = refKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    if (q.types?.length && !q.types.includes(ref.type)) continue
    if (q.namespace && ref.namespace !== q.namespace) continue
    if (q.repo && ref.repo !== q.repo) continue
    // AuthZ scope is applied before scoring and paging.
    if (!await ctx.canRead(ref)) continue
    const eff = await resolveEffective(ref, ctx.getOwn)
    const effective = eff.effective
    const empty =
      !effective.tags.length &&
      !Object.keys(effective.labels).length
    if (empty) continue
    if (!filtersMatch(q, effective)) continue
    const s = score(terms, ref, effective)
    if (s === null) continue
    hits.push({
      ref,
      name: nameOf(ref),
      url: metaUrl(ref),
      score: s,
      ...(eff.own ? { updatedAt: eff.own.updatedAt } : {}),
      effective,
    })
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
      refKey(a.ref).localeCompare(refKey(b.ref)),
  )

  const facets: MetaFacets = { types: {}, tags: {}, labelKeys: {} }
  for (const h of hits) {
    facets.types[h.ref.type] = (facets.types[h.ref.type] ?? 0) + 1
    for (const t of h.effective.tags) facets.tags[t.value] = (facets.tags[t.value] ?? 0) + 1
    for (const k of Object.keys(h.effective.labels)) {
      facets.labelKeys[k] = (facets.labelKeys[k] ?? 0) + 1
    }
  }

  let start = 0
  if (query.cursor) {
    const idx = hits.findIndex((h) => refKey(h.ref) === query.cursor)
    if (idx >= 0) start = idx + 1
  }
  const page = hits.slice(start, start + limit)
  const nextCursor =
    start + limit < hits.length ? refKey(page[page.length - 1].ref) : null
  return { hits: page, nextCursor, total: hits.length, facets }
}
