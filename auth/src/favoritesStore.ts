import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { favorites } from './db/schema.js'
import type { AuditEvent } from './audit.js'

export const FAVORITE_TYPES = ['namespace', 'repo', 'branch', 'stage', 'job', 'session'] as const
export type FavoriteType = (typeof FAVORITE_TYPES)[number]

/** Returns null for unknown types. */
export function normalizeFavoriteType(t: unknown): FavoriteType | null {
  return typeof t === 'string' && (FAVORITE_TYPES as readonly string[]).includes(t)
    ? (t as FavoriteType)
    : null
}

export type FavoriteRow = { type: FavoriteType; id: string; at: string }

export function favoriteUserKey(user: { iss: string; sub: string }): string {
  return JSON.stringify([user.iss, user.sub])
}

export async function listFavorites(userKey: string): Promise<FavoriteRow[]> {
  const rows = await getDb().select().from(favorites).where(eq(favorites.userKey, userKey)).orderBy(desc(favorites.at))
  return rows.map((r) => ({ type: r.type as FavoriteType, id: r.id, at: r.at.toISOString() }))
}

/** Idempotent; returns true when newly added. */
export async function addFavorite(userKey: string, type: FavoriteType, id: string): Promise<boolean> {
  const added = await getDb()
    .insert(favorites)
    .values({ userKey, type, id, at: new Date() })
    .onConflictDoNothing()
    .returning({ id: favorites.id })
  return added.length > 0
}

export async function removeFavorite(userKey: string, type: FavoriteType, id: string): Promise<boolean> {
  const gone = await getDb()
    .delete(favorites)
    .where(and(eq(favorites.userKey, userKey), eq(favorites.type, type), eq(favorites.id, id)))
    .returning({ id: favorites.id })
  return gone.length > 0
}

/** Remove matching favorites for every user. Returns how many rows were dropped. */
async function purgeWhere(where: SQL): Promise<number> {
  const gone = await getDb().delete(favorites).where(where).returning({ id: favorites.id })
  return gone.length
}

const startsWith = (prefix: string) => sql`starts_with(${favorites.id}, ${prefix})`
const target = (type: FavoriteType, id: string) => and(eq(favorites.type, type), eq(favorites.id, id))
const repoScoped = inArray(favorites.type, ['repo', 'branch', 'stage'])

/** Delete favorites that point at entities removed by an audited mutation. */
export async function purgeFavoritesForAudit(event: AuditEvent): Promise<void> {
  if (event.status < 200 || event.status >= 300) return
  const d = event.detail ?? {}
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  switch (event.action) {
    case 'namespace.delete':
      if (event.namespace) {
        await purgeWhere(or(target('namespace', event.namespace), and(repoScoped, startsWith(`${event.namespace}/`)))!)
      }
      break
    case 'repo.delete':
      if (event.namespace && event.repo) {
        const prefix = `${event.namespace}/${event.repo}`
        await purgeWhere(
          or(
            target('repo', prefix),
            and(
              inArray(favorites.type, ['branch', 'stage']),
              or(eq(favorites.id, prefix), startsWith(`${prefix}@`), startsWith(`${prefix}!`)),
            ),
          )!,
        )
      }
      break
    case 'branch.delete': {
      const b = str(d.branch)
      if (event.namespace && event.repo && b) await purgeWhere(target('branch', `${event.namespace}/${event.repo}@${b}`)!)
      break
    }
    case 'workspace.delete': {
      const w = str(d.workspace_id)
      if (event.namespace && event.repo && w) await purgeWhere(target('stage', `${event.namespace}/${event.repo}!${w}`)!)
      break
    }
    case 'session.destroy': {
      const s = str(d.session_id)
      if (s) await purgeWhere(target('session', s)!)
      break
    }
  }
}
