import { join } from 'node:path'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
import type { AuditEvent } from './audit.js'

export const FAVORITE_TYPES = ['namespace', 'repo', 'branch', 'workspace', 'job', 'session'] as const
export type FavoriteType = (typeof FAVORITE_TYPES)[number]

export type FavoriteRow = { type: FavoriteType; id: string; at: string }
type FavoritesFile = { users: Record<string, FavoriteRow[]> }

function path(): string {
  return join(env.dataDir, 'favorites.json')
}

export function favoriteUserKey(user: { iss: string; sub: string }): string {
  return JSON.stringify([user.iss, user.sub])
}

function read(): FavoritesFile {
  const f = readJsonFile<FavoritesFile>(path(), { users: {} })
  return f && typeof f.users === 'object' && f.users ? f : { users: {} }
}

export function listFavorites(userKey: string): FavoriteRow[] {
  return [...(read().users[userKey] ?? [])].sort((a, b) => b.at.localeCompare(a.at))
}

/** Idempotent; returns true when newly added. */
export function addFavorite(userKey: string, type: FavoriteType, id: string): boolean {
  const f = read()
  const rows = (f.users[userKey] ??= [])
  if (rows.some((r) => r.type === type && r.id === id)) return false
  rows.push({ type, id, at: new Date().toISOString() })
  writeJsonFile(path(), f)
  return true
}

export function removeFavorite(userKey: string, type: FavoriteType, id: string): boolean {
  const f = read()
  const rows = f.users[userKey] ?? []
  const next = rows.filter((r) => !(r.type === type && r.id === id))
  if (next.length === rows.length) return false
  f.users[userKey] = next
  writeJsonFile(path(), f)
  return true
}

/** Remove matching favorites for every user. Returns how many rows were dropped. */
export function purgeFavorites(match: (row: FavoriteRow) => boolean): number {
  const f = read()
  let n = 0
  for (const [key, rows] of Object.entries(f.users)) {
    const next = rows.filter((r) => !match(r))
    n += rows.length - next.length
    if (next.length) f.users[key] = next
    else delete f.users[key]
  }
  if (n) writeJsonFile(path(), f)
  return n
}

function inRepo(row: FavoriteRow, ns: string, repo?: string): boolean {
  if (row.type === 'namespace') return false
  if (row.type === 'job' || row.type === 'session') return false
  const prefix = repo ? `${ns}/${repo}` : `${ns}/`
  return repo ? row.id === prefix || row.id.startsWith(`${prefix}@`) || row.id.startsWith(`${prefix}!`) : row.id.startsWith(prefix)
}

/** Delete favorites that point at entities removed by an audited mutation. */
export function purgeFavoritesForAudit(event: AuditEvent): void {
  if (event.status < 200 || event.status >= 300) return
  const d = event.detail ?? {}
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  switch (event.action) {
    case 'namespace.delete':
      if (event.namespace) {
        const ns = event.namespace
        purgeFavorites((r) => (r.type === 'namespace' && r.id === ns) || inRepo(r, ns))
      }
      break
    case 'repo.delete':
      if (event.namespace && event.repo) {
        const { namespace: ns, repo } = event
        purgeFavorites((r) => (r.type === 'repo' && r.id === `${ns}/${repo}`) || inRepo(r, ns, repo))
      }
      break
    case 'branch.delete': {
      const b = str(d.branch)
      if (event.namespace && event.repo && b) {
        purgeFavorites((r) => r.type === 'branch' && r.id === `${event.namespace}/${event.repo}@${b}`)
      }
      break
    }
    case 'workspace.delete': {
      const w = str(d.workspace_id)
      if (event.namespace && event.repo && w) {
        purgeFavorites((r) => r.type === 'workspace' && r.id === `${event.namespace}/${event.repo}!${w}`)
      }
      break
    }
    case 'session.destroy': {
      const s = str(d.session_id)
      if (s) purgeFavorites((r) => r.type === 'session' && r.id === s)
      break
    }
  }
}
