import { join } from 'node:path'
import { env } from './env.js'
import { normalizeDesktopSession } from './sessionsMounts.js'
import { createJsonlLog } from './stores.js'
import type { DesktopSession, DesktopSessionStatus } from './sessionsTypes.js'

const log = createJsonlLog<DesktopSession>(() => join(env.sessionsDataDir, 'sessions.jsonl'))

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

export function appendSession(session: DesktopSession): void {
  log.append(session)
}

function readAll(): DesktopSession[] {
  const byId = new Map<string, DesktopSession>()
  for (const row of log.readAll()) {
    if (row?.id) byId.set(row.id, normalizeDesktopSession(row))
  }
  return [...byId.values()]
}

/** Latest record per id (JSONL append-only). */
export function listSessions(): DesktopSession[] {
  return readAll().sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getSessionRecord(id: string): DesktopSession | null {
  try {
    const safe = assertSafeSessionId(id)
    return listSessions().find((s) => s.id === safe) ?? null
  } catch {
    return null
  }
}

export function updateSession(
  id: string,
  patch: Partial<DesktopSession>,
): DesktopSession | null {
  const cur = getSessionRecord(id)
  if (!cur) return null
  const next: DesktopSession = { ...cur, ...patch, id: cur.id }
  appendSession(next)
  return next
}

export function rewriteSessionsCompact(): void {
  log.rewrite(listSessions())
}

export function countActiveForOwner(sub: string, iss: string): number {
  const active: DesktopSessionStatus[] = [
    'provisioning',
    'ready',
    'connected',
    'stopping',
  ]
  return listSessions().filter(
    (s) =>
      s.owner.sub === sub &&
      s.owner.iss === iss &&
      active.includes(s.status),
  ).length
}
