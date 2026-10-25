import { join } from 'node:path'
import { env } from './env.js'
import { normalizeDesktopSession } from './sessionsMounts.js'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from './db/database.js'
import { desktopSessions } from './db/schema.js'
import type { DesktopSession, DesktopSessionStatus } from './sessionsTypes.js'

export function assertSafeSessionId(sessionId: string): string {
  const id = String(sessionId || '').trim().toLowerCase()
  if (!/^[0-9a-f]{8,64}$/.test(id)) {
    throw new Error('invalid session id')
  }
  return id
}

export function sessionsWorkDir(sessionId: string): string {
  const id = assertSafeSessionId(sessionId)
  return join(env.sessionsDataDir, 'work', id)
}

export async function appendSession(session: DesktopSession): Promise<void> {
  const row = {
    id: session.id,
    status: session.status,
    ownerSub: session.owner.sub,
    ownerIss: session.owner.iss,
    createdAt: new Date(session.created_at),
    body: session,
  }
  await getDb().insert(desktopSessions).values(row).onConflictDoUpdate({ target: desktopSessions.id, set: row })
}

const normalized = (rows: Array<{ body: DesktopSession }>) => rows.map((r) => normalizeDesktopSession(r.body))

/** Sessions in one of these states, newest first. */
export async function listSessionsWithStatus(...statuses: DesktopSessionStatus[]): Promise<DesktopSession[]> {
  if (!statuses.length) return []
  return normalized(
    await getDb()
      .select({ body: desktopSessions.body })
      .from(desktopSessions)
      .where(inArray(desktopSessions.status, statuses))
      .orderBy(desc(desktopSessions.createdAt)),
  )
}

/** One record per id, newest first. */
export async function listSessions(): Promise<DesktopSession[]> {
  return normalized(
    await getDb().select({ body: desktopSessions.body }).from(desktopSessions).orderBy(desc(desktopSessions.createdAt)),
  )
}

export async function getSessionRecord(id: string): Promise<DesktopSession | null> {
  let safe: string
  try {
    safe = assertSafeSessionId(id)
  } catch {
    return null
  }
  const [row] = await getDb().select({ body: desktopSessions.body }).from(desktopSessions).where(eq(desktopSessions.id, safe))
  return row ? normalizeDesktopSession(row.body) : null
}

export async function updateSession(
  id: string,
  patch: Partial<DesktopSession>,
): Promise<DesktopSession | null> {
  const cur = await getSessionRecord(id)
  if (!cur) return null
  const next: DesktopSession = { ...cur, ...patch, id: cur.id }
  await appendSession(next)
  return next
}

export async function countActiveForOwner(sub: string, iss: string): Promise<number> {
  const active: DesktopSessionStatus[] = ['provisioning', 'ready', 'connected', 'stopping']
  const [row] = await getDb()
    .select({ n: count() })
    .from(desktopSessions)
    .where(and(
      eq(desktopSessions.ownerSub, sub),
      eq(desktopSessions.ownerIss, iss),
      inArray(desktopSessions.status, active),
    ))
  return row?.n ?? 0
}
