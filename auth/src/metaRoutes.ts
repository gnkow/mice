import type { Context, Hono } from 'hono'
import { createHash } from 'node:crypto'
import { actorFromUser } from './audit.js'
import { getNamespace } from './authzNamespaceStore.js'
import { env } from './env.js'
import { getJob } from './jobsStore.js'
import { canEditEntity, canReadEntity, type MetaAuthzDeps } from './metaAuthz.js'
import { resolveEffective } from './metaResolve.js'
import {
  searchMeta,
  type MetaSearchQuery,
  type SearchCtx,
} from './metaSearch.js'
import {
  buildRecord,
  deleteOwnRecord,
  getOwnRecord,
  getRevision,
  listHistory,
  listOwnRecords,
  putOwnRecord,
} from './metaStore.js'
import {
  ENTITY_TYPES,
  MetaError,
  parseRef,
  refKey,
  withRepoScope,
  type EntityRef,
  type EntityType,
  type MetaPatch,
  type MetaRecord,
} from './metaTypes.js'
import type { SessionUser } from './authentication/session/session.js'
import { getSessionRecord } from './sessionsStore.js'
import { guarded, type GuardArgs } from './authentication/session/routeGuard.js'

export const lookup: MetaAuthzDeps = {
  sessionOwner: async (id) => {
    const s = await getSessionRecord(id)
    return s ? `${s.owner.iss}|${s.owner.sub}` : null
  },
}

/* ---- oxen lookups (cached) ---- */

const repoCache = new Map<string, { at: number; ok: boolean }>()
const TTL_MS = 15_000

async function oxenJson(path: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(`${env.oxenUpstream}${path}`, { redirect: 'manual' })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* not json */
    }
    return { status: res.status, body }
  } catch {
    return null
  }
}

async function repoExists(ns: string, repo: string): Promise<boolean> {
  const key = `${ns}/${repo}`
  const hit = repoCache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok
  const r = await oxenJson(
    `/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}`,
  )
  // Only an explicit 404 means "missing"; upstream errors must not block edits.
  const ok = !(r && r.status === 404)
  repoCache.set(key, { at: Date.now(), ok })
  return ok
}

/** Parse + normalize + validate existence. Throws MetaError. */
export async function resolveRef(type: string, id: string, scope?: EntityRef['scope']): Promise<EntityRef> {
  let ref = parseRef(type, id, scope)
  switch (ref.type) {
    case 'namespace':
      if (!await getNamespace(ref.id)) throw new MetaError(404, `Namespace "${ref.id}" not found`)
      break
    case 'job': {
      const job = await getJob(ref.id)
      if (!job) throw new MetaError(404, `Job "${ref.id}" not found`)
      ref = withRepoScope(ref, { namespace: job.namespace, repo: job.repo })
      break
    }
    case 'session':
      if (!await getSessionRecord(ref.id)) throw new MetaError(404, `Session "${ref.id}" not found`)
      break
    default:
      if (ref.namespace && ref.repo && !(await repoExists(ref.namespace, ref.repo))) {
        throw new MetaError(404, `Repository "${ref.namespace}/${ref.repo}" not found`)
      }
  }
  return ref
}

/** Only explicitly annotated entities are searchable. */
async function searchCandidates(): Promise<EntityRef[]> {
  return (await listOwnRecords()).map(r => r.ref)
}

function ctxFor(user: SessionUser, candidates: EntityRef[]): SearchCtx {
  return {
    candidates,
    getOwn: getOwnRecord,
    canRead: (ref) => canReadEntity(user, ref, lookup),
  }
}

/** Route-family error shape: a MetaError answers its own status. */
function metaError(err: unknown, c: Context): Response | null {
  return err instanceof MetaError ? c.json({ error: err.message }, err.status) : null
}

const readPolicy = { allowScoped: true, fail: metaError } as const
const writePolicy = { ...readPolicy, mutates: true, body: 'json', invalidBody: 'Invalid JSON' } as const

function refFromQuery(c: Context): { type: string; id: string } | null {
  const type = c.req.query('type')
  const id = c.req.query('id')
  return type && id ? { type, id } : null
}

function queryScope(c: Context): EntityRef['scope'] {
  const kind = c.req.query('scope')
  const id = c.req.query('revision')
  if (!kind || kind === 'repository') {
    if (id) throw new MetaError(400, 'revision requires branch or commit scope')
    return undefined
  }
  if ((kind !== 'branch' && kind !== 'commit') || !id) throw new MetaError(400, 'scope must be repository, branch or commit; branch/commit requires revision')
  return { kind, id }
}

const coverage = { complete: true, description: 'All explicitly annotated resources visible to you.' }

async function metadataVersion(ref: EntityRef): Promise<string> {
  return createHash('sha256').update(JSON.stringify([refKey(ref), await getRevision(ref)])).digest('hex')
}

async function checkVersion(ref: EntityRef, expected: unknown): Promise<void> {
  if (expected !== undefined && (typeof expected !== 'string' || expected !== await metadataVersion(ref))) {
    throw new MetaError(409, 'Metadata changed. Reload and review before saving.')
  }
}

function diff(before: MetaRecord | null, after: MetaRecord | null) {
  const empty = { tags: [] as string[], labels: {} }
  const b = before ?? empty
  const a = after ?? empty
  const changedMap = (x: Record<string, unknown>, y: Record<string, unknown>) => {
    const out: Record<string, { old: unknown; new: unknown }> = {}
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out[k] = { old: x[k] ?? null, new: y[k] ?? null }
    }
    return out
  }
  const tagsAdded = a.tags.filter((t) => !b.tags.includes(t))
  const tagsRemoved = b.tags.filter((t) => !a.tags.includes(t))
  return {
    ...(tagsAdded.length ? { tags_added: tagsAdded } : {}),
    ...(tagsRemoved.length ? { tags_removed: tagsRemoved } : {}),
    labels: changedMap(b.labels, a.labels),
  }
}

function parseSearch(c: Context): MetaSearchQuery {
  const all = (k: string) => c.req.queries(k) ?? []
  const labels: Record<string, string> = {}
  for (const [k, v] of Object.entries(c.req.query())) {
    if (k.startsWith('label.') && v) labels[k.slice(6).toLowerCase()] = v
  }
  if (c.req.query('source')) throw new MetaError(400, 'Metadata provenance filters are no longer supported')
  const limit = Number(c.req.query('limit'))
  return {
    q: c.req.query('q') || undefined,
    types: all('type').filter((t): t is EntityType =>
      (ENTITY_TYPES as readonly string[]).includes(t),
    ),
    namespace: c.req.query('namespace') || undefined,
    repo: c.req.query('repo') || undefined,
    tags: all('tag').map((t) => t.toLowerCase()),
    labels,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    cursor: c.req.query('cursor') || undefined,
  }
}

async function metaAudit(
  audit: GuardArgs['audit'],
  action: string,
  ref: EntityRef | null,
  message: string,
  detail: Record<string, unknown>,
) {
  await audit({
    action,
    ...(ref?.namespace ? { namespace: ref.namespace } : {}),
    ...(ref?.repo ? { repo: ref.repo } : {}),
    message,
    detail: { ...detail, ...(ref ? { resource: ref } : {}) },
  })
}

export function registerMetaRoutes(app: Hono) {
  app.get('/auth/meta', guarded(readPolicy, async ({ c, user }) => {
    const q = refFromQuery(c)
    if (!q) return c.json({ error: 'type and id are required' }, 400)
    const ref = await resolveRef(q.type, q.id, queryScope(c))
    if (!await canReadEntity(user, ref, lookup)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (c.req.query('trace')) throw new MetaError(400, 'Metadata inheritance traces are no longer supported')
    const eff = await resolveEffective(ref, getOwnRecord)
    return c.json({
      ref,
      revision: await getRevision(ref),
      version: await metadataVersion(ref),
      own: eff.own,
      effective: eff.effective,
      canEdit: await canEditEntity(user, ref, lookup),
    })
  }))

  // Bulk explicit metadata for list views; unknown or unreadable entities are omitted.
  app.post('/auth/meta/batch', guarded(writePolicy, async ({ c, user, body: raw }) => {
    const body = raw as { refs?: { type?: string; id?: string; scope?: EntityRef['scope'] }[] }
    const refs = Array.isArray(body.refs) ? body.refs.slice(0, 200) : []
    const items: Record<string, unknown> = {}
    for (const r of refs) {
      if (!r?.type || !r.id) continue
      try {
        const ref = await resolveRef(r.type, r.id, r.scope)
        if (!await canReadEntity(user, ref, lookup)) continue
        items[refKey(ref)] = (await resolveEffective(ref, getOwnRecord)).effective
      } catch (err) {
        if (!(err instanceof MetaError && [400, 403, 404].includes(err.status))) throw err
      }
    }
    return c.json({ items })
  }))

  const write = guarded(writePolicy, async ({ c, user, body, audit }) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Metadata body must be an object' }, 400)
    const r = body.ref as { type?: string; id?: string; scope?: EntityRef['scope'] } | undefined
    if (!r?.type || !r.id) return c.json({ error: 'ref.type and ref.id are required' }, 400)
    const ref = await resolveRef(r.type, r.id, r.scope)
    if (!await canEditEntity(user, ref, lookup)) {
      return c.json({ error: 'Forbidden: cannot edit metadata on this entity' }, 403)
    }
    for (const field of ['inherit', 'propagation', 'removeTags', 'unset']) {
      if (Object.hasOwn(body, field)) throw new MetaError(422, `${field} is no longer supported; metadata is explicit-only`)
    }
    const patch: MetaPatch = {
      tags: body.tags as MetaPatch['tags'],
      labels: body.labels as MetaPatch['labels'],
    }
    await checkVersion(ref, body.ifVersion)
    const ifRevision =
      typeof body.ifRevision === 'number' ? body.ifRevision : undefined
    if (body.ifRevision !== undefined && (typeof ifRevision !== 'number' || !Number.isSafeInteger(ifRevision) || ifRevision < 0)) throw new MetaError(400, 'ifRevision must be a nonnegative integer')
    const actor = actorFromUser(user)
    const prev = await getOwnRecord(ref)
    const next = buildRecord(ref, prev, patch, actor)
    const { before, after } = await putOwnRecord(ref, patch, actor, ifRevision)
    await metaAudit(audit, 'meta.set', ref, `Updated metadata on ${ref.type} ${ref.id}`, {
      entity_type: ref.type,
      entity_id: ref.id,
      revision: after?.revision ?? next.revision,
      changed: diff(before, after),
    })
    return c.json({ ok: true, own: after, revision: await getRevision(ref) })
  })
  app.put('/auth/meta', write)
  app.patch('/auth/meta', write)

  app.delete('/auth/meta', guarded({ ...readPolicy, mutates: true }, async ({ c, user, audit }) => {
    const q = refFromQuery(c)
    if (!q) return c.json({ error: 'type and id are required' }, 400)
    const ref = await resolveRef(q.type, q.id, queryScope(c))
    if (!await canEditEntity(user, ref, lookup)) {
      return c.json({ error: 'Forbidden: cannot edit metadata on this entity' }, 403)
    }
    await checkVersion(ref, c.req.query('ifVersion'))
    const rawRevision = c.req.query('ifRevision')
    const revision = rawRevision === undefined ? undefined : Number(rawRevision)
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) throw new MetaError(400, 'ifRevision must be a nonnegative integer')
    const { before } = await deleteOwnRecord(ref, actorFromUser(user), revision)
    if (before) {
      await metaAudit(audit, 'meta.delete', ref, `Removed metadata from ${ref.type} ${ref.id}`, {
        entity_type: ref.type,
        entity_id: ref.id,
        revision: await getRevision(ref),
        changed: diff(before, null),
      })
    }
    return c.json({ ok: true, removed: !!before, revision: await getRevision(ref) })
  }))

  app.get('/auth/meta/history', guarded(readPolicy, async ({ c, user }) => {
    const q = refFromQuery(c)
    if (!q) return c.json({ error: 'type and id are required' }, 400)
    const ref = parseRef(q.type, q.id, queryScope(c))
    const full = ref.type === 'job' ? await resolveRef(q.type, q.id).catch(() => ref) : ref
    if (!await canReadEntity(user, full, lookup)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({ history: await listHistory(ref) })
  }))

  app.get('/auth/meta/search', guarded(readPolicy, async ({ c, user }) => {
    const query = parseSearch(c)
    const res = await searchMeta(query, ctxFor(user, await searchCandidates()))
    return c.json({
      hits: res.hits,
      nextCursor: res.nextCursor,
      total: res.total,
      facets: res.facets,
      coverage,
    })
  }))
}
