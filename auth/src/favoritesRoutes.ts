import type { Context, Hono } from 'hono'
import { env } from './env.js'
import {
  FAVORITE_TYPES,
  addFavorite,
  favoriteUserKey,
  listFavorites,
  normalizeFavoriteType,
  removeFavorite,
  type FavoriteRow,
  type FavoriteType,
} from './favoritesStore.js'
import { canonicalizeFavorite } from './favoritesCanonical.js'
import { getJob } from './jobsStore.js'
import { canReadEntity } from './metaAuthz.js'
import { lookup, resolveRef } from './metaRoutes.js'
import { MetaError, type EntityRef } from './metaTypes.js'
import { guarded, type SessionUser } from './authentication/index.js'

const MAX_LOOKUP = 500

class HttpError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404) {
    super(message)
  }
}

function parseTarget(type: unknown, id: unknown): { type: FavoriteType; id: string } {
  const norm = normalizeFavoriteType(type)
  if (!norm) {
    throw new HttpError(`type must be one of ${FAVORITE_TYPES.join(', ')}`, 400)
  }
  if (typeof id !== 'string' || !id.trim()) throw new HttpError('id is required', 400)
  return { type: norm, id: id.trim() }
}

type CanonicalFavoriteTarget = NonNullable<Awaited<ReturnType<typeof canonicalizeFavorite>>>

/** Resolve a client id (name path or UUID) to the stored UUID key + meta lookup id. */
async function resolveFavoriteTarget(
  type: FavoriteType,
  rawId: string,
): Promise<CanonicalFavoriteTarget> {
  const canonical = await canonicalizeFavorite(type, rawId)
  if (!canonical) throw new HttpError('Entity not found', 404)
  return canonical
}

/** "gone" means the entity no longer exists (safe to drop); anything else keeps the row. */
async function check(
  user: SessionUser,
  row: { type: FavoriteType; id: string },
  out?: { ref?: EntityRef; canonical?: CanonicalFavoriteTarget },
): Promise<'ok' | 'gone' | 'hidden'> {
  const canonical = await canonicalizeFavorite(row.type, row.id)
  if (!canonical) return 'gone'
  if (out) out.canonical = canonical
  let ref: EntityRef
  try {
    // Oxen stages are `workspace` entities in the meta layer.
    ref = await resolveRef(row.type === 'stage' ? 'workspace' : row.type, canonical.metaId)
  } catch (err) {
    if (err instanceof MetaError && (err.status === 404 || err.status === 400)) return 'gone'
    return 'hidden'
  }
  if (out) out.ref = ref
  return (await canReadEntity(user, ref, lookup)) ? 'ok' : 'hidden'
}

/** Route-family error shape: `{ error }` with the error's own status. */
function favoriteError(err: unknown, c: Context): Response | null {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  if (err instanceof MetaError) return c.json({ error: err.message }, err.status as 400 | 404)
  return null
}

const policy = {
  originCheck: true,
  requires: { capability: 'hasFavorites', message: 'Favorites unavailable' },
  fail: favoriteError,
} as const

export function registerFavoritesRoutes(app: Hono): void {
  app.get('/auth/favorites', guarded(policy, async ({ c, user }) => {
    const key = favoriteUserKey(user)
    const want = c.req.query('type')
    const wantType = want ? parseTarget(want, 'x').type : undefined
    const visible: Array<FavoriteRow & { namespace?: string; repo?: string; name?: string }> = []
    for (const row of await listFavorites(key)) {
      const out: { ref?: EntityRef; canonical?: CanonicalFavoriteTarget } = {}
      const s = await check(user, row, out)
      if (s === 'ok') {
        const job = row.type === 'job' ? await getJob(row.id) : null
        visible.push({
          ...row,
          id: out.canonical?.id ?? row.id,
          ...(out.canonical?.namespace || out.ref?.namespace
            ? { namespace: out.canonical?.namespace ?? out.ref?.namespace }
            : {}),
          ...(out.canonical?.repo || out.ref?.repo
            ? { repo: out.canonical?.repo ?? out.ref?.repo }
            : {}),
          ...(job?.name ? { name: job.name } : {}),
        })
      }
      else if (s === 'gone') await removeFavorite(key, row.type, row.id)
    }
    const counts = Object.fromEntries(FAVORITE_TYPES.map((t) => [t, visible.filter((r) => r.type === t).length]))
    return c.json({ counts, items: wantType ? visible.filter((r) => r.type === wantType) : visible })
  }))

  app.put('/auth/favorites', guarded({ ...policy, body: 'optional' }, async ({ c, user, body }) => {
    const t = parseTarget(body.type, body.id)
    const canonical = await resolveFavoriteTarget(t.type, t.id)
    const s = await check(user, { type: t.type, id: canonical.id })
    if (s === 'gone') throw new HttpError('Entity not found', 404)
    if (s === 'hidden') throw new HttpError('Forbidden', 403)
    const created = await addFavorite(favoriteUserKey(user), t.type, canonical.id)
    return c.json(
      {
        ok: true,
        favorite: true,
        type: t.type,
        id: canonical.id,
        ...(canonical.namespace ? { namespace: canonical.namespace } : {}),
        ...(canonical.repo ? { repo: canonical.repo } : {}),
      },
      created ? 201 : 200,
    )
  }))

  app.delete('/auth/favorites', guarded(policy, async ({ c, user }) => {
    const t = parseTarget(c.req.query('type'), c.req.query('id'))
    const canonical = await resolveFavoriteTarget(t.type, t.id)
    await removeFavorite(favoriteUserKey(user), t.type, canonical.id)
    return c.json({ ok: true, favorite: false, type: t.type, id: canonical.id })
  }))

  // Bulk membership for list views: the subset of requested entities that are favorites.
  app.post('/auth/favorites/lookup', guarded({ ...policy, body: 'optional' }, async ({ c, user, body }) => {
    if (!Array.isArray(body.items)) throw new HttpError('items must be an array', 400)
    if (body.items.length > MAX_LOOKUP) throw new HttpError(`At most ${MAX_LOOKUP} items`, 400)
    const mine = new Set((await listFavorites(favoriteUserKey(user))).map((r) => `${r.type}\0${r.id}`))
    const favorites: Array<{ type: FavoriteType; id: string }> = []
    for (const item of body.items as Array<{ type?: unknown; id?: unknown }>) {
      const t = parseTarget(item?.type, item?.id)
      const canonical = await canonicalizeFavorite(t.type, t.id)
      if (canonical && mine.has(`${t.type}\0${canonical.id}`)) {
        favorites.push({ type: t.type, id: canonical.id })
      }
    }
    return c.json({ favorites })
  }))
}
