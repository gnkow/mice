import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { env } from './env.js'
import { normalizeDesktopSession } from './sessionsMounts.js'
import type { DesktopSession, DesktopSessionStatus } from './sessionsTypes.js'

function storePath(): string {
  return join(env.sessionsDataDir, 'sessions.jsonl')
}

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
  const p = storePath()
  mkdirSync(env.sessionsDataDir, { recursive: true })
  appendFileSync(p, `${JSON.stringify(session)}\n`, 'utf8')
}

function readAll(): DesktopSession[] {
  const p = storePath()
  if (!existsSync(p)) return []
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
  const byId = new Map<string, DesktopSession>()
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as DesktopSession
      if (row?.id) byId.set(row.id, normalizeDesktopSession(row))
    } catch {
      /* skip bad line */
    }
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
  const all = listSessions()
  const p = storePath()
  mkdirSync(env.sessionsDataDir, { recursive: true })
  const tmp = `${p}.tmp`
  writeFileSync(
    tmp,
    all.map((s) => JSON.stringify(s)).join('\n') + (all.length ? '\n' : ''),
    'utf8',
  )
  renameSync(tmp, p)
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
