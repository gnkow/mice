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
import { getJob } from './jobsStore.js'
import { canReadEntity } from './metaAuthz.js'
import { lookup, resolveRef } from './metaRoutes.js'
import { MetaError, type EntityRef } from './metaTypes.js'
import type { SessionUser } from './session.js'
import { authenticate } from './requireAuth.js'

const MAX_LOOKUP = 500

class HttpError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404) {
    super(message)
  }
}

async function requireUser(c: Context): Promise<SessionUser> {
  const r = await authenticate(c, { originCheck: true, requires: { capability: 'hasFavorites', message: 'Service principals have no favorites' } })
  if (!r.ok) throw new HttpError(r.error, r.status)
  return r.user
}

function parseTarget(type: unknown, id: unknown): { type: FavoriteType; id: string } {
  const norm = normalizeFavoriteType(type)
  if (!norm) {
    throw new HttpError(`type must be one of ${FAVORITE_TYPES.join(', ')}`, 400)
  }
  if (typeof id !== 'string' || !id.trim()) throw new HttpError('id is required', 400)
  return { type: norm, id: id.trim() }
}

/** "gone" means the entity no longer exists (safe to drop); anything else keeps the row. */
async function check(
  user: SessionUser,
  row: { type: FavoriteType; id: string },
  out?: { ref?: EntityRef },
): Promise<'ok' | 'gone' | 'hidden'> {
  let ref: EntityRef
  try {
    // Oxen stages are `workspace` entities in the meta layer.
    ref = await resolveRef(row.type === 'stage' ? 'workspace' : row.type, row.id)
  } catch (err) {
    if (err instanceof MetaError && (err.status === 404 || err.status === 400)) return 'gone'
    return 'hidden'
  }
  if (out) out.ref = ref
  return canReadEntity(user, ref, lookup) ? 'ok' : 'hidden'
}

function fail(c: Context, err: unknown) {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  if (err instanceof MetaError) return c.json({ error: err.message }, err.status as 400 | 404)
  throw err
}

export function registerFavoritesRoutes(app: Hono): void {
  app.get('/auth/favorites', async (c) => {
    try {
      const user = await requireUser(c)
      const key = favoriteUserKey(user)
      const want = c.req.query('type')
      const wantType = want ? parseTarget(want, 'x').type : undefined
      const visible: Array<FavoriteRow & { namespace?: string; repo?: string; name?: string }> = []
      for (const row of listFavorites(key)) {
        const out: { ref?: EntityRef } = {}
        const s = await check(user, row, out)
        if (s === 'ok') {
          const job = row.type === 'job' ? getJob(row.id) : null
          visible.push({
            ...row,
            ...(out.ref?.namespace ? { namespace: out.ref.namespace } : {}),
            ...(out.ref?.repo ? { repo: out.ref.repo } : {}),
            ...(job?.name ? { name: job.name } : {}),
          })
        }
        else if (s === 'gone') removeFavorite(key, row.type, row.id)
      }
      const counts = Object.fromEntries(FAVORITE_TYPES.map((t) => [t, visible.filter((r) => r.type === t).length]))
      return c.json({ counts, items: wantType ? visible.filter((r) => r.type === wantType) : visible })
    } catch (err) {
      return fail(c, err)
    }
  })

  app.put('/auth/favorites', async (c) => {
    try {
      const user = await requireUser(c)
      const body = (await c.req.json().catch(() => null)) as { type?: unknown; id?: unknown } | null
      const t = parseTarget(body?.type, body?.id)
      const s = await check(user, t)
      if (s === 'gone') throw new HttpError('Entity not found', 404)
      if (s === 'hidden') throw new HttpError('Forbidden', 403)
      const created = addFavorite(favoriteUserKey(user), t.type, t.id)
      return c.json({ ok: true, favorite: true, ...t }, created ? 201 : 200)
    } catch (err) {
      return fail(c, err)
    }
  })

  app.delete('/auth/favorites', async (c) => {
    try {
      const user = await requireUser(c)
      const t = parseTarget(c.req.query('type'), c.req.query('id'))
      removeFavorite(favoriteUserKey(user), t.type, t.id)
      return c.json({ ok: true, favorite: false, ...t })
    } catch (err) {
      return fail(c, err)
    }
  })

  // Bulk membership for list views: the subset of requested entities that are favorites.
  app.post('/auth/favorites/lookup', async (c) => {
    try {
      const user = await requireUser(c)
      const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null
      if (!Array.isArray(body?.items)) throw new HttpError('items must be an array', 400)
      if (body.items.length > MAX_LOOKUP) throw new HttpError(`At most ${MAX_LOOKUP} items`, 400)
      const mine = new Set(listFavorites(favoriteUserKey(user)).map((r) => `${r.type}\0${r.id}`))
      const favorites = (body.items as Array<{ type?: unknown; id?: unknown }>)
        .map((i) => parseTarget(i?.type, i?.id))
        .filter((i) => mine.has(`${i.type}\0${i.id}`))
      return c.json({ favorites })
    } catch (err) {
      return fail(c, err)
    }
  })
}
