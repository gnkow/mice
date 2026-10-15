import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { env } from './env.js'
import type { SessionUser } from './session.js'

export type AuditVia = 'session' | 'pat'

export type AuditActor = {
  sub: string
  iss: string
  email: string
  name: string
}

export type AuditEvent = {
  id: string
  ts: string
  actor: AuditActor
  via: AuditVia
  method: string
  path: string
  status: number
  action: string
  namespace?: string
  repo?: string
  message?: string
  detail?: Record<string, unknown>
}

export type AuditQuery = {
  actor?: string
  namespace?: string
  repo?: string
  action?: string
  since?: string
  until?: string
  limit?: number
  /** Exclusive: return events older than this id (reverse chronological). */
  cursor?: string
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

function storePath(): string {
  return join(env.dataDir, 'audit.jsonl')
}

export function actorFromUser(user: SessionUser): AuditActor {
  return {
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
  }
}

/** Coarse action + ns/repo from oxen API path. */
export function classifyPath(
  method: string,
  pathname: string,
): {
  action: string
  namespace?: string
  repo?: string
  detail?: Record<string, unknown>
} {
  const path = pathname.replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  // Expect: api, repos, ns, repo, ...
  if (parts[0] !== 'api') {
    return { action: 'other' }
  }

  if (parts[1] === 'repos' && parts.length === 2 && method === 'POST') {
    return { action: 'repo.create' }
  }

  if (parts[1] === 'repos' && parts.length >= 4) {
    const namespace = safeDecode(parts[2])
    const repo = safeDecode(parts[3])
    const rest = parts.slice(4)

    if (rest[0] === 'file') {
      const branch = rest[1] ? safeDecode(rest[1]) : undefined
      const filePath = rest.slice(2).map(safeDecode).join('/')
      return {
        action: 'file.write',
        namespace,
        repo,
        detail: {
          ...(branch ? { branch } : {}),
          ...(filePath ? { path: filePath } : {}),
        },
      }
    }
    if (rest[0] === 'branches') {
      const branch = rest[1] ? safeDecode(rest[1]) : undefined
      let action = 'branch.other'
      if (method === 'POST' && rest.length === 1) action = 'branch.create'
      else if (method === 'DELETE') action = 'branch.delete'
      else if (method === 'PUT' || method === 'PATCH') action = 'branch.update'
      return {
        action,
        namespace,
        repo,
        detail: branch ? { branch } : undefined,
      }
    }
    if (rest[0] === 'merge' || rest[0] === 'merges') {
      return { action: 'merge', namespace, repo }
    }
    if (rest[0] === 'workspaces') {
      return { action: 'workspace.other', namespace, repo }
    }
    if (method === 'DELETE' && rest.length === 0) {
      return { action: 'repo.delete', namespace, repo }
    }
    return { action: 'other', namespace, repo }
  }

  if (parts[1] === 'namespaces' && method === 'POST') {
    return { action: 'namespace.create' }
  }

  return { action: 'other' }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function extractMessageFromJson(
  body: Record<string, unknown>,
): string | undefined {
  for (const key of ['message', 'commit_message']) {
    const v = body[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
  }
  return undefined
}

export function extractMessageFromForm(form: FormData): string | undefined {
  for (const key of ['message', 'commit_message']) {
    const v = form.get(key)
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
  }
  return undefined
}

export function extractRepoCreateFromJson(
  body: Record<string, unknown>,
): { namespace?: string; repo?: string } {
  const namespace =
    typeof body.namespace === 'string' ? body.namespace : undefined
  const repo = typeof body.name === 'string' ? body.name : undefined
  return { namespace, repo }
}

export function appendAudit(
  partial: Omit<AuditEvent, 'id' | 'ts'> & { id?: string; ts?: string },
): AuditEvent | null {
  const event: AuditEvent = {
    id: partial.id ?? randomBytes(8).toString('hex'),
    ts: partial.ts ?? new Date().toISOString(),
    actor: partial.actor,
    via: partial.via,
    method: partial.method,
    path: partial.path,
    status: partial.status,
    action: partial.action,
    ...(partial.namespace ? { namespace: partial.namespace } : {}),
    ...(partial.repo ? { repo: partial.repo } : {}),
    ...(partial.message ? { message: partial.message } : {}),
    ...(partial.detail && Object.keys(partial.detail).length
      ? { detail: partial.detail }
      : {}),
  }
  try {
    mkdirSync(dirname(storePath()), { recursive: true })
    appendFileSync(storePath(), `${JSON.stringify(event)}\n`, 'utf8')
    return event
  } catch (err) {
    console.error('[boxen-auth] audit append failed', err)
    return null
  }
}

function readAllEvents(): AuditEvent[] {
  try {
    const raw = readFileSync(storePath(), 'utf8')
    const out: AuditEvent[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        out.push(JSON.parse(trimmed) as AuditEvent)
      } catch {
        /* skip bad lines */
      }
    }
    return out
  } catch {
    return []
  }
}

export function queryAudit(q: AuditQuery): {
  events: AuditEvent[]
  nextCursor: string | null
} {
  const limit = Math.min(
    Math.max(1, q.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  )
  let events = readAllEvents()

  // Newest first
  events.reverse()

  if (q.cursor) {
    const idx = events.findIndex((e) => e.id === q.cursor)
    if (idx >= 0) events = events.slice(idx + 1)
  }

  if (q.actor) {
    const a = q.actor.toLowerCase()
    events = events.filter(
      (e) =>
        e.actor.sub.toLowerCase().includes(a) ||
        e.actor.email.toLowerCase().includes(a) ||
        e.actor.name.toLowerCase().includes(a),
    )
  }
  if (q.namespace) {
    events = events.filter((e) => e.namespace === q.namespace)
  }
  if (q.repo) {
    events = events.filter((e) => e.repo === q.repo)
  }
  if (q.action) {
    events = events.filter(
      (e) => e.action === q.action || e.action.startsWith(`${q.action}.`),
    )
  }
  if (q.since) {
    const since = q.since
    events = events.filter((e) => e.ts >= since)
  }
  if (q.until) {
    const until = q.until
    events = events.filter((e) => e.ts <= until)
  }

  const page = events.slice(0, limit)
  const nextCursor =
    page.length === limit && events.length > limit
      ? (page[page.length - 1]?.id ?? null)
      : null

  return { events: page, nextCursor }
}
